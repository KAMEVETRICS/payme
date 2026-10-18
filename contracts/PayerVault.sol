// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

interface IERC1271 {
    function isValidSignature(bytes32 hash, bytes calldata signature) external view returns (bytes4);
}

/// @title PayerVault
/// @notice Holds one business's stablecoins (USDC, and EURC for euro invoices). Agents pay suppliers from it, but only under rules
///         the owner signed: a supplier address, the token to pay in, a budget per period (or in total for a
///         one-off order), a start, and an expiry. The agent submits the owner's signature
///         and this contract checks it. Each payment must go to the rule's supplier, fit
///         the rule's budget for the current period and the vault's total cap, land while
///         the rule and the vault are live, and use an invoice id that has not been paid.
///         An address the vault has never seen waits out a delay before it can be paid,
///         which covers both new suppliers and "our wallet changed". Anything else
///         reverts with a named error. The agent decides; this contract bounds it.
/// @dev On Arc, USDC's ERC-20 interface (6 decimals) and the native gas balance
///      (18 decimals) are the same funds. This contract only uses ERC-20 interfaces and
///      has no selfdestruct path. Amounts are in each token's own units, and the cap is
///      per token; the vault never converts between tokens.
contract PayerVault {
    /// @notice The terms the owner signs. `period` is in seconds; 0 makes the rule a
    ///         one-off order whose `budget` is a lifetime total. `ref` is a hash of the
    ///         agreed terms (quote, contract, or purchase order). `salt` makes each
    ///         approval unique so the same signature cannot be used twice.
    struct RuleTerms {
        address payee;
        address token;
        uint256 budget;
        uint256 period;
        uint256 startsAt;
        uint256 expiresAt;
        bytes32 ref;
        bytes32 salt;
    }

    struct Rule {
        RuleTerms terms;
        bool active;
    }

    bytes32 public constant RULE_TYPEHASH = keccak256(
        "Rule(address payee,address token,uint256 budget,uint256 period,uint256 startsAt,uint256 expiresAt,bytes32 ref,bytes32 salt)"
    );
    bytes32 private constant DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 private constant NAME_HASH = keccak256("PayerVault");
    bytes32 private constant VERSION_HASH = keccak256("3");
    uint256 private constant MAX_S = 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0;

    address public immutable owner;
    address public agent;

    IERC20[] private _tokens;
    mapping(address token => bool) public tokenAllowed;
    mapping(address token => uint256) public capOf;
    mapping(address token => uint256) public spentOf;
    uint256 public expiresAt;
    uint256 public payeeDelay;

    uint256 public ruleCount;
    mapping(uint256 ruleId => Rule) internal _rules;
    mapping(uint256 ruleId => mapping(uint256 periodIndex => uint256)) public spentInPeriod;
    mapping(bytes32 digest => bool) public approvalUsed;
    mapping(address payee => uint256) public payeeActiveAt;
    mapping(bytes32 invoiceId => bool) public invoicePaid;

    event AgentSet(address indexed agent);
    event CapSet(address indexed token, uint256 cap);
    event ExpirySet(uint256 expiresAt);
    event PayeeDelaySet(uint256 delay);
    event RuleAdded(
        uint256 indexed ruleId,
        address indexed payee,
        address token,
        uint256 budget,
        uint256 period,
        uint256 startsAt,
        uint256 expiresAt,
        bytes32 ref,
        bytes32 digest
    );
    event PayeeScheduled(address indexed payee, uint256 activeAt);
    event RuleRevoked(uint256 indexed ruleId, address indexed by);
    event Paid(
        uint256 indexed ruleId,
        bytes32 indexed invoiceId,
        address indexed payee,
        address token,
        uint256 amount,
        uint256 periodIndex
    );
    event Withdrawn(address indexed token, address indexed to, uint256 amount);

    error NotOwner();
    error NotAgent();
    error NotOwnerOrAgent();
    error ZeroAddress();
    error ZeroAmount();
    error TokenNotAllowed(address token);
    error InvalidSignature();
    error ApprovalAlreadyUsed(bytes32 digest);
    error VaultExpired(uint256 expiresAt);
    error RuleNotActive(uint256 ruleId);
    error RuleNotStarted(uint256 ruleId, uint256 startsAt);
    error RuleExpired(uint256 ruleId, uint256 expiresAt);
    error PayeeMismatch(uint256 ruleId, address expected, address actual);
    error PayeeNotYetActive(address payee, uint256 activeAt);
    error InvoiceAlreadyPaid(bytes32 invoiceId);
    error OverBudget(uint256 ruleId, uint256 remaining, uint256 amount);
    error OverCap(uint256 remaining, uint256 amount);
    error InsufficientBalance(uint256 balance, uint256 amount);
    error TransferFailed();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    /// @param tokens_ The stablecoins this vault may pay out. `cap_` starts as the cap
    ///        for each of them; the owner can change each with setCap.
    constructor(
        IERC20[] memory tokens_,
        address owner_,
        address agent_,
        uint256 cap_,
        uint256 expiresAt_,
        uint256 payeeDelay_
    ) {
        if (owner_ == address(0) || tokens_.length == 0) revert ZeroAddress();
        for (uint256 i; i < tokens_.length; ++i) {
            address token = address(tokens_[i]);
            if (token == address(0)) revert ZeroAddress();
            if (tokenAllowed[token]) continue;
            tokenAllowed[token] = true;
            _tokens.push(tokens_[i]);
            capOf[token] = cap_;
            emit CapSet(token, cap_);
        }
        owner = owner_;
        agent = agent_;
        expiresAt = expiresAt_;
        payeeDelay = payeeDelay_;
        emit AgentSet(agent_);
        emit ExpirySet(expiresAt_);
        emit PayeeDelaySet(payeeDelay_);
    }

    // ---- Rules: signed by the owner, submitted by anyone ----

    /// @notice Add a rule the owner approved. The owner can call this directly with an
    ///         empty signature; anyone else must supply the owner's EIP-712 signature
    ///         over `terms`.
    function addRule(RuleTerms calldata terms, bytes calldata signature) external returns (uint256 ruleId) {
        if (terms.payee == address(0)) revert ZeroAddress();
        if (terms.budget == 0) revert ZeroAmount();
        if (!tokenAllowed[terms.token]) revert TokenNotAllowed(terms.token);

        bytes32 digest = hashRule(terms);
        if (approvalUsed[digest]) revert ApprovalAlreadyUsed(digest);
        if (msg.sender != owner && !_isOwnerSignature(digest, signature)) revert InvalidSignature();
        approvalUsed[digest] = true;

        ruleId = ++ruleCount;
        _rules[ruleId] = Rule(terms, true);

        if (payeeActiveAt[terms.payee] == 0) {
            uint256 activeAt = block.timestamp + payeeDelay;
            payeeActiveAt[terms.payee] = activeAt;
            emit PayeeScheduled(terms.payee, activeAt);
        }

        emit RuleAdded(
            ruleId, terms.payee, terms.token, terms.budget, terms.period, terms.startsAt, terms.expiresAt, terms.ref, digest
        );
    }

    /// @notice Stop a rule. The agent may do this too, since it only reduces what can
    ///         be paid; for example when it suspects a fraudulent invoice.
    function revokeRule(uint256 ruleId) external {
        if (msg.sender != owner && msg.sender != agent) revert NotOwnerOrAgent();
        if (!_rules[ruleId].active) revert RuleNotActive(ruleId);
        _rules[ruleId].active = false;
        emit RuleRevoked(ruleId, msg.sender);
    }

    // ---- Payments: the agent only ----

    /// @notice Pay an invoice under a rule. `payee` is the address the agent read from
    ///         the invoice; if it differs from the rule's supplier, the payment reverts
    ///         instead of being redirected.
    function pay(uint256 ruleId, bytes32 invoiceId, address payee, uint256 amount) external {
        if (msg.sender != agent) revert NotAgent();
        if (amount == 0) revert ZeroAmount();
        if (block.timestamp >= expiresAt) revert VaultExpired(expiresAt);

        Rule storage rule_ = _rules[ruleId];
        RuleTerms storage t = rule_.terms;
        if (!rule_.active) revert RuleNotActive(ruleId);
        if (block.timestamp < t.startsAt) revert RuleNotStarted(ruleId, t.startsAt);
        if (block.timestamp >= t.expiresAt) revert RuleExpired(ruleId, t.expiresAt);
        if (payee != t.payee) revert PayeeMismatch(ruleId, t.payee, payee);
        if (block.timestamp < payeeActiveAt[payee]) revert PayeeNotYetActive(payee, payeeActiveAt[payee]);
        if (invoicePaid[invoiceId]) revert InvoiceAlreadyPaid(invoiceId);

        uint256 periodIndex = _periodIndex(t);
        uint256 left = t.budget - spentInPeriod[ruleId][periodIndex];
        if (amount > left) revert OverBudget(ruleId, left, amount);
        address token = t.token;
        uint256 capLeft = capRemaining(token);
        if (amount > capLeft) revert OverCap(capLeft, amount);
        uint256 balance = IERC20(token).balanceOf(address(this));
        if (amount > balance) revert InsufficientBalance(balance, amount);

        invoicePaid[invoiceId] = true;
        spentInPeriod[ruleId][periodIndex] += amount;
        spentOf[token] += amount;

        _transfer(token, payee, amount);
        emit Paid(ruleId, invoiceId, payee, token, amount, periodIndex);
    }

    // ---- Owner ----

    /// @notice Set or remove (address(0)) the agent allowed to pay.
    function setAgent(address agent_) external onlyOwner {
        agent = agent_;
        emit AgentSet(agent_);
    }

    /// @notice Change the most the agent may ever pay out in one token.
    function setCap(address token, uint256 cap_) external onlyOwner {
        if (!tokenAllowed[token]) revert TokenNotAllowed(token);
        capOf[token] = cap_;
        emit CapSet(token, cap_);
    }

    /// @notice Change when the vault stops paying.
    function setExpiry(uint256 expiresAt_) external onlyOwner {
        expiresAt = expiresAt_;
        emit ExpirySet(expiresAt_);
    }

    /// @notice Change how long a never-seen address waits before it can be paid.
    ///         Applies to addresses first seen after the change.
    function setPayeeDelay(uint256 delay) external onlyOwner {
        payeeDelay = delay;
        emit PayeeDelaySet(delay);
    }

    /// @notice Take funds back out of the vault. Works for any token, so nothing sent
    ///         here by mistake is stuck.
    function withdraw(address token, address to, uint256 amount) external onlyOwner {
        if (to == address(0) || token == address(0)) revert ZeroAddress();
        _transfer(token, to, amount);
        emit Withdrawn(token, to, amount);
    }

    // ---- Views ----

    function rule(uint256 ruleId) external view returns (RuleTerms memory terms, bool active) {
        Rule storage r = _rules[ruleId];
        return (r.terms, r.active);
    }

    /// @notice What the agent can still pay under a rule right now.
    function ruleRemaining(uint256 ruleId) external view returns (uint256) {
        Rule storage r = _rules[ruleId];
        RuleTerms storage t = r.terms;
        if (!r.active || block.timestamp < t.startsAt || block.timestamp >= t.expiresAt) return 0;
        return t.budget - spentInPeriod[ruleId][_periodIndex(t)];
    }

    function capRemaining(address token) public view returns (uint256) {
        uint256 cap_ = capOf[token];
        uint256 spent_ = spentOf[token];
        return cap_ > spent_ ? cap_ - spent_ : 0;
    }

    /// @notice The tokens this vault may pay out.
    function tokens() external view returns (IERC20[] memory) {
        return _tokens;
    }

    function domainSeparator() public view returns (bytes32) {
        return keccak256(abi.encode(DOMAIN_TYPEHASH, NAME_HASH, VERSION_HASH, block.chainid, address(this)));
    }

    /// @notice The EIP-712 digest the owner signs for `terms`.
    function hashRule(RuleTerms calldata t) public view returns (bytes32) {
        bytes32 structHash = keccak256(
            abi.encode(RULE_TYPEHASH, t.payee, t.token, t.budget, t.period, t.startsAt, t.expiresAt, t.ref, t.salt)
        );
        return keccak256(abi.encodePacked("\x19\x01", domainSeparator(), structHash));
    }

    // ---- Internal ----

    function _periodIndex(RuleTerms storage t) private view returns (uint256) {
        return t.period == 0 ? 0 : (block.timestamp - t.startsAt) / t.period;
    }

    /// @dev Accepts a plain 65-byte ECDSA signature from an owner account, or an
    ///      ERC-1271 approval from an owner smart account.
    function _isOwnerSignature(bytes32 digest, bytes calldata signature) private view returns (bool) {
        if (owner.code.length > 0) {
            (bool ok, bytes memory ret) =
                owner.staticcall(abi.encodeCall(IERC1271.isValidSignature, (digest, signature)));
            return ok && ret.length >= 32 && abi.decode(ret, (bytes4)) == IERC1271.isValidSignature.selector;
        }
        if (signature.length != 65) return false;
        bytes32 r = bytes32(signature[0:32]);
        bytes32 s = bytes32(signature[32:64]);
        uint8 v = uint8(signature[64]);
        if (uint256(s) > MAX_S) return false;
        address signer = ecrecover(digest, v, r, s);
        return signer != address(0) && signer == owner;
    }

    function _transfer(address token, address to, uint256 amount) private {
        (bool ok, bytes memory data) = token.call(abi.encodeCall(IERC20.transfer, (to, amount)));
        if (!ok || (data.length != 0 && !abi.decode(data, (bool)))) revert TransferFailed();
    }
}

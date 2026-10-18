// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {PayerVault, IERC20} from "../contracts/PayerVault.sol";
import {VaultFactory} from "../contracts/VaultFactory.sol";

/// Minimal 6-decimal stand-in for USDC's and EURC's ERC-20 interfaces on Arc.
contract MockUSDC {
    uint8 public constant decimals = 6;
    mapping(address => uint256) public balanceOf;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        require(balanceOf[msg.sender] >= amount, "balance");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

/// A smart-account owner that approves whatever its signer key signs (ERC-1271).
contract MockSmartAccount {
    address public immutable signer;

    constructor(address signer_) {
        signer = signer_;
    }

    function isValidSignature(bytes32 hash, bytes calldata sig) external view returns (bytes4) {
        address recovered = ecrecover(hash, uint8(sig[64]), bytes32(sig[0:32]), bytes32(sig[32:64]));
        return recovered == signer ? bytes4(0x1626ba7e) : bytes4(0xffffffff);
    }
}

contract PayerVaultTest is Test {
    uint256 constant USDC = 1e6;

    MockUSDC usdc;
    MockUSDC eurc;
    VaultFactory factory;
    PayerVault vault;

    address owner;
    uint256 ownerKey;
    address agent = makeAddr("agent");
    address supplierA = makeAddr("supplierA");
    address supplierB = makeAddr("supplierB");
    address attacker = makeAddr("attacker");
    address stranger = makeAddr("stranger");

    uint256 t0;
    uint256 weekly; // rule: supplier A, up to 2,000 USDC a week

    function setUp() public {
        vm.warp(1_760_000_000);
        t0 = block.timestamp;
        (owner, ownerKey) = makeAddrAndKey("owner");

        usdc = new MockUSDC();
        eurc = new MockUSDC();
        IERC20[] memory tokens = new IERC20[](2);
        tokens[0] = IERC20(address(usdc));
        tokens[1] = IERC20(address(eurc));
        factory = new VaultFactory(tokens);
        vault = factory.createVault(owner, agent, 10_000 * USDC, t0 + 90 days, 1 days);
        usdc.mint(address(vault), 20_000 * USDC);
        eurc.mint(address(vault), 5_000 * USDC);

        weekly = _addSigned(_terms(supplierA, 2_000 * USDC, 7 days, "weekly-A"));
        vm.warp(t0 + 1 days); // supplier A's new address clears the delay
    }

    // ---- Helpers ----

    function _terms(address payee, uint256 budget, uint256 period, bytes32 salt)
        internal
        view
        returns (PayerVault.RuleTerms memory)
    {
        return PayerVault.RuleTerms(payee, address(usdc), budget, period, t0, t0 + 60 days, keccak256("QUOTE"), salt);
    }

    function _eurTerms(address payee, uint256 budget, uint256 period, bytes32 salt)
        internal
        view
        returns (PayerVault.RuleTerms memory t)
    {
        t = _terms(payee, budget, period, salt);
        t.token = address(eurc);
    }

    function _sign(uint256 key, PayerVault v, PayerVault.RuleTerms memory t) internal view returns (bytes memory) {
        (uint8 sv, bytes32 r, bytes32 s) = vm.sign(key, v.hashRule(t));
        return abi.encodePacked(r, s, sv);
    }

    /// The agent submits a rule the owner signed in chat.
    function _addSigned(PayerVault.RuleTerms memory t) internal returns (uint256) {
        bytes memory sig = _sign(ownerKey, vault, t);
        vm.prank(agent);
        return vault.addRule(t, sig);
    }

    function _pay(uint256 ruleId, bytes32 invoice, address payee, uint256 amount) internal {
        vm.prank(agent);
        vault.pay(ruleId, invoice, payee, amount);
    }

    // ---- Factory ----

    function test_FactoryGivesTheBusinessTheVault() public view {
        assertEq(vault.owner(), owner);
        assertEq(vault.agent(), agent);
        assertEq(vault.capOf(address(usdc)), 10_000 * USDC);
        assertEq(vault.capOf(address(eurc)), 10_000 * USDC);
        assertEq(vault.payeeDelay(), 1 days);
        IERC20[] memory tokens = vault.tokens();
        assertEq(tokens.length, 2);
        assertEq(address(tokens[0]), address(usdc));
        assertEq(address(tokens[1]), address(eurc));
    }

    // ---- Rules ----

    function test_AgentSubmitsOwnerSignedRule() public view {
        (PayerVault.RuleTerms memory t, bool active) = vault.rule(weekly);
        assertTrue(active);
        assertEq(t.payee, supplierA);
        assertEq(t.budget, 2_000 * USDC);
        assertEq(vault.ruleRemaining(weekly), 2_000 * USDC);
    }

    function test_OwnerAddsRuleWithoutSignature() public {
        vm.prank(owner);
        uint256 id = vault.addRule(_terms(supplierA, 500 * USDC, 0, "direct"), "");
        assertEq(vault.ruleRemaining(id), 500 * USDC);
    }

    function test_RejectsRuleNotSignedByOwner() public {
        (, uint256 strangerKey) = makeAddrAndKey("stranger-key");
        PayerVault.RuleTerms memory t = _terms(attacker, 5_000 * USDC, 0, "fake");
        bytes memory sig = _sign(strangerKey, vault, t);
        vm.prank(agent);
        vm.expectRevert(PayerVault.InvalidSignature.selector);
        vault.addRule(t, sig);
    }

    function test_RejectsAgentAddingRuleWithoutSignature() public {
        vm.prank(agent);
        vm.expectRevert(PayerVault.InvalidSignature.selector);
        vault.addRule(_terms(attacker, 5_000 * USDC, 0, "self-approved"), "");
    }

    function test_RejectsAlteredTerms() public {
        PayerVault.RuleTerms memory t = _terms(supplierA, 1_000 * USDC, 0, "altered");
        bytes memory sig = _sign(ownerKey, vault, t);
        t.budget = 9_000 * USDC;
        vm.prank(agent);
        vm.expectRevert(PayerVault.InvalidSignature.selector);
        vault.addRule(t, sig);
    }

    function test_RejectsReusedApproval() public {
        PayerVault.RuleTerms memory t = _terms(supplierA, 1_000 * USDC, 0, "once");
        bytes memory sig = _sign(ownerKey, vault, t);
        bytes32 digest = vault.hashRule(t);
        vm.prank(agent);
        vault.addRule(t, sig);

        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(PayerVault.ApprovalAlreadyUsed.selector, digest));
        vault.addRule(t, sig);
    }

    function test_RejectsApprovalSignedForAnotherVault() public {
        PayerVault other = factory.createVault(owner, agent, 10_000 * USDC, t0 + 90 days, 1 days);
        PayerVault.RuleTerms memory t = _terms(supplierA, 1_000 * USDC, 0, "cross-vault");
        bytes memory sig = _sign(ownerKey, other, t);
        vm.prank(agent);
        vm.expectRevert(PayerVault.InvalidSignature.selector);
        vault.addRule(t, sig);
    }

    /// The struct hash below comes from viem's hashStruct for the same terms, so this
    /// fails if the contract's typed data ever drifts from what a wallet signs.
    function test_TypedDataMatchesViem() public view {
        PayerVault.RuleTerms memory t = PayerVault.RuleTerms(
            address(0xaa),
            address(0xbb),
            2_000 * USDC,
            7 days,
            1_760_000_000,
            1_765_184_000,
            bytes32(0x1111111111111111111111111111111111111111111111111111111111111111),
            bytes32(0x2222222222222222222222222222222222222222222222222222222222222222)
        );
        bytes32 viemStructHash = 0x5fb9f874cc49290f4f0056c5d8911ebf98aa60cd98b65c5e21c65a0714417a2a;
        bytes32 domain = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("PayerVault"),
                keccak256("3"),
                block.chainid,
                address(vault)
            )
        );
        assertEq(vault.domainSeparator(), domain);
        assertEq(vault.hashRule(t), keccak256(abi.encodePacked("\x19\x01", domain, viemStructHash)));
    }

    function test_SmartAccountOwnerSigns() public {
        (address signer, uint256 signerKey) = makeAddrAndKey("passkey-signer");
        MockSmartAccount account = new MockSmartAccount(signer);
        PayerVault smartVault = factory.createVault(address(account), agent, 10_000 * USDC, t0 + 90 days, 0);

        PayerVault.RuleTerms memory t = _terms(supplierA, 1_000 * USDC, 0, "smart");
        bytes memory good = _sign(signerKey, smartVault, t);
        vm.prank(agent);
        smartVault.addRule(t, good);

        PayerVault.RuleTerms memory t2 = _terms(attacker, 1_000 * USDC, 0, "smart-bad");
        bytes memory bad = _sign(ownerKey, smartVault, t2);
        vm.prank(agent);
        vm.expectRevert(PayerVault.InvalidSignature.selector);
        smartVault.addRule(t2, bad);
    }

    // ---- Payments that go through ----

    function test_PaysWithinWeeklyBudget() public {
        vm.expectEmit(address(vault));
        emit PayerVault.Paid(weekly, "INV-1", supplierA, address(usdc), 1_500 * USDC, 0);
        _pay(weekly, "INV-1", supplierA, 1_500 * USDC);
        _pay(weekly, "INV-2", supplierA, 500 * USDC);

        assertEq(usdc.balanceOf(supplierA), 2_000 * USDC);
        assertEq(vault.ruleRemaining(weekly), 0);
        assertEq(vault.spentOf(address(usdc)), 2_000 * USDC);
    }

    function test_BudgetResetsNextPeriod() public {
        _pay(weekly, "INV-1", supplierA, 2_000 * USDC);
        vm.warp(t0 + 7 days);
        assertEq(vault.ruleRemaining(weekly), 2_000 * USDC);
        _pay(weekly, "INV-2", supplierA, 2_000 * USDC);
        assertEq(usdc.balanceOf(supplierA), 4_000 * USDC);
    }

    function test_KnownSupplierSkipsDelay() public {
        uint256 oneOff = _addSigned(_terms(supplierA, 300 * USDC, 0, "one-off-A"));
        _pay(oneOff, "INV-1", supplierA, 300 * USDC);
        assertEq(usdc.balanceOf(supplierA), 300 * USDC);
    }

    // ---- Refusals ----

    function test_RefusesChangedPayee() public {
        vm.expectRevert(abi.encodeWithSelector(PayerVault.PayeeMismatch.selector, weekly, supplierA, attacker));
        _pay(weekly, "INV-1", attacker, 1_000 * USDC);
        assertEq(usdc.balanceOf(attacker), 0);
    }

    function test_NewAddressWaitsOutDelay() public {
        uint256 ruleB = _addSigned(_terms(supplierB, 1_000 * USDC, 0, "new-B"));
        uint256 activeAt = block.timestamp + 1 days;

        vm.expectRevert(abi.encodeWithSelector(PayerVault.PayeeNotYetActive.selector, supplierB, activeAt));
        _pay(ruleB, "INV-1", supplierB, 1_000 * USDC);

        vm.warp(activeAt);
        _pay(ruleB, "INV-1", supplierB, 1_000 * USDC);
        assertEq(usdc.balanceOf(supplierB), 1_000 * USDC);
    }

    function test_RefusesOverWeeklyBudget() public {
        _pay(weekly, "INV-1", supplierA, 1_500 * USDC);
        vm.expectRevert(abi.encodeWithSelector(PayerVault.OverBudget.selector, weekly, 500 * USDC, 600 * USDC));
        _pay(weekly, "INV-2", supplierA, 600 * USDC);
    }

    function test_OneOffOrderIsALifetimeTotal() public {
        uint256 oneOff = _addSigned(_terms(supplierA, 600 * USDC, 0, "one-off"));
        _pay(oneOff, "INV-1", supplierA, 600 * USDC);
        vm.warp(t0 + 30 days);
        vm.expectRevert(abi.encodeWithSelector(PayerVault.OverBudget.selector, oneOff, 0, 1 * USDC));
        _pay(oneOff, "INV-2", supplierA, 1 * USDC);
    }

    function test_RefusesSameInvoiceTwice() public {
        _pay(weekly, "INV-1", supplierA, 100 * USDC);
        vm.expectRevert(abi.encodeWithSelector(PayerVault.InvoiceAlreadyPaid.selector, bytes32("INV-1")));
        _pay(weekly, "INV-1", supplierA, 100 * USDC);
    }

    function test_RefusesOverVaultCap() public {
        uint256 big = _addSigned(_terms(supplierA, 9_000 * USDC, 0, "big"));
        _pay(big, "INV-1", supplierA, 9_000 * USDC);
        vm.expectRevert(abi.encodeWithSelector(PayerVault.OverCap.selector, 1_000 * USDC, 2_000 * USDC));
        _pay(weekly, "INV-2", supplierA, 2_000 * USDC);
    }

    function test_RefusesBeforeRuleStarts() public {
        PayerVault.RuleTerms memory t = _terms(supplierA, 500 * USDC, 0, "later");
        t.startsAt = t0 + 10 days;
        uint256 later = _addSigned(t);
        vm.expectRevert(abi.encodeWithSelector(PayerVault.RuleNotStarted.selector, later, t0 + 10 days));
        _pay(later, "INV-1", supplierA, 100 * USDC);
    }

    function test_RefusesAfterRuleExpires() public {
        vm.warp(t0 + 60 days);
        vm.expectRevert(abi.encodeWithSelector(PayerVault.RuleExpired.selector, weekly, t0 + 60 days));
        _pay(weekly, "INV-1", supplierA, 100 * USDC);
    }

    function test_RefusesAfterVaultExpires() public {
        vm.warp(t0 + 90 days);
        vm.expectRevert(abi.encodeWithSelector(PayerVault.VaultExpired.selector, t0 + 90 days));
        _pay(weekly, "INV-1", supplierA, 100 * USDC);
    }

    function test_RefusesUnknownRule() public {
        vm.expectRevert(abi.encodeWithSelector(PayerVault.RuleNotActive.selector, 99));
        _pay(99, "INV-1", supplierA, 100 * USDC);
    }

    function test_RefusesWhenUnderfunded() public {
        vm.prank(owner);
        vault.withdraw(address(usdc), owner, 19_000 * USDC);
        vm.expectRevert(abi.encodeWithSelector(PayerVault.InsufficientBalance.selector, 1_000 * USDC, 1_500 * USDC));
        _pay(weekly, "INV-1", supplierA, 1_500 * USDC);
    }

    // ---- Revoking ----

    function test_AgentCanStopARule() public {
        vm.prank(agent);
        vault.revokeRule(weekly);
        vm.expectRevert(abi.encodeWithSelector(PayerVault.RuleNotActive.selector, weekly));
        _pay(weekly, "INV-1", supplierA, 100 * USDC);
        assertEq(vault.ruleRemaining(weekly), 0);
    }

    function test_OwnerCanStopARule() public {
        vm.prank(owner);
        vault.revokeRule(weekly);
        vm.expectRevert(abi.encodeWithSelector(PayerVault.RuleNotActive.selector, weekly));
        _pay(weekly, "INV-1", supplierA, 100 * USDC);
    }

    function test_StrangerCannotStopARule() public {
        vm.prank(stranger);
        vm.expectRevert(PayerVault.NotOwnerOrAgent.selector);
        vault.revokeRule(weekly);
    }

    // ---- Roles ----

    function test_OnlyAgentPays() public {
        vm.prank(owner);
        vm.expectRevert(PayerVault.NotAgent.selector);
        vault.pay(weekly, "INV-1", supplierA, 100 * USDC);

        vm.prank(stranger);
        vm.expectRevert(PayerVault.NotAgent.selector);
        vault.pay(weekly, "INV-1", supplierA, 100 * USDC);
    }

    function test_RemovedAgentCannotPay() public {
        vm.prank(owner);
        vault.setAgent(address(0));
        vm.expectRevert(PayerVault.NotAgent.selector);
        _pay(weekly, "INV-1", supplierA, 100 * USDC);
    }

    function test_OnlyOwnerChangesSettings() public {
        vm.startPrank(agent);
        vm.expectRevert(PayerVault.NotOwner.selector);
        vault.setAgent(attacker);
        vm.expectRevert(PayerVault.NotOwner.selector);
        vault.setCap(address(usdc), type(uint256).max);
        vm.expectRevert(PayerVault.NotOwner.selector);
        vault.setExpiry(type(uint256).max);
        vm.expectRevert(PayerVault.NotOwner.selector);
        vault.setPayeeDelay(0);
        vm.expectRevert(PayerVault.NotOwner.selector);
        vault.withdraw(address(usdc), agent, 1 * USDC);
        vm.stopPrank();
    }

    function test_OwnerWithdraws() public {
        vm.prank(owner);
        vault.withdraw(address(usdc), owner, 20_000 * USDC);
        assertEq(usdc.balanceOf(owner), 20_000 * USDC);
    }

    // ---- Euro (EURC) ----

    function test_PaysEurRuleInEurc() public {
        uint256 eur = _addSigned(_eurTerms(supplierA, 1_000 * USDC, 7 days, "weekly-A-eur"));
        vm.expectEmit(address(vault));
        emit PayerVault.Paid(eur, "EUR-1", supplierA, address(eurc), 800 * USDC, 0);
        _pay(eur, "EUR-1", supplierA, 800 * USDC);
        assertEq(eurc.balanceOf(supplierA), 800 * USDC);
        assertEq(usdc.balanceOf(supplierA), 0);
        assertEq(vault.spentOf(address(eurc)), 800 * USDC);
        assertEq(vault.spentOf(address(usdc)), 0);
    }

    function test_RejectsRuleInAnotherToken() public {
        MockUSDC other = new MockUSDC();
        PayerVault.RuleTerms memory t = _terms(supplierA, 100 * USDC, 0, "other-token");
        t.token = address(other);
        bytes memory sig = _sign(ownerKey, vault, t);
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(PayerVault.TokenNotAllowed.selector, address(other)));
        vault.addRule(t, sig);
    }

    function test_SigningForUsdcDoesNotApproveEurc() public {
        PayerVault.RuleTerms memory t = _terms(supplierA, 100 * USDC, 0, "swap-token");
        bytes memory sig = _sign(ownerKey, vault, t);
        t.token = address(eurc);
        vm.prank(agent);
        vm.expectRevert(PayerVault.InvalidSignature.selector);
        vault.addRule(t, sig);
    }

    function test_CapsAreSeparatePerToken() public {
        vm.prank(owner);
        vault.setCap(address(eurc), 500 * USDC);
        uint256 eur = _addSigned(_eurTerms(supplierA, 1_000 * USDC, 0, "eur-cap"));
        _pay(eur, "EUR-1", supplierA, 500 * USDC);
        vm.expectRevert(abi.encodeWithSelector(PayerVault.OverCap.selector, 0, 1 * USDC));
        _pay(eur, "EUR-2", supplierA, 1 * USDC);
        _pay(weekly, "USD-1", supplierA, 2_000 * USDC); // the USDC cap is untouched
        assertEq(vault.capRemaining(address(usdc)), 8_000 * USDC);
    }

    function test_EurPaymentChecksEurcBalance() public {
        uint256 eur = _addSigned(_eurTerms(supplierA, 9_000 * USDC, 0, "eur-big"));
        vm.expectRevert(abi.encodeWithSelector(PayerVault.InsufficientBalance.selector, 5_000 * USDC, 6_000 * USDC));
        _pay(eur, "EUR-1", supplierA, 6_000 * USDC);
    }

    function test_OwnerWithdrawsEurc() public {
        vm.prank(owner);
        vault.withdraw(address(eurc), owner, 5_000 * USDC);
        assertEq(eurc.balanceOf(owner), 5_000 * USDC);
    }

    // ---- Invariant: a week's payments never exceed the weekly budget ----

    function testFuzz_WeeklyBudgetHolds(uint256 a, uint256 b, uint256 c) public {
        uint256[3] memory amounts =
            [bound(a, 1, 3_000 * USDC), bound(b, 1, 3_000 * USDC), bound(c, 1, 3_000 * USDC)];
        for (uint256 i; i < 3; ++i) {
            vm.prank(agent);
            try vault.pay(weekly, bytes32(i + 1), supplierA, amounts[i]) {} catch {}
        }
        assertLe(usdc.balanceOf(supplierA), 2_000 * USDC);
        assertEq(vault.spentOf(address(usdc)), usdc.balanceOf(supplierA));
    }
}

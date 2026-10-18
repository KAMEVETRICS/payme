// Preview: node scripts/recover-mail.ts. Restore retained emails: add --apply.
// No model, scheduler, or payment runner is invoked.
import { recoverLegacyMail } from "../src/web/mail-recovery.ts";

const apply = process.argv.includes("--apply");
console.log(JSON.stringify({ mode: apply ? "apply" : "preview", ...recoverLegacyMail({ apply }) }));

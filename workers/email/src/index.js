// Cloudflare Email Worker for Payer. Email Routing hands it every message sent to
// *@invoices.<domain>; it passes the raw message to Payer unparsed (parsing happens
// on Payer's side, which keeps this well inside the free plan's CPU limit).
// If Payer cannot take it, the email is forwarded to the fallback address so the
// invoice is never lost.
export default {
  async email(message, env) {
    let accepted = false;
    try {
      const raw = await new Response(message.raw).arrayBuffer();
      const response = await fetch(env.WEBHOOK_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.WEBHOOK_SECRET}`,
          "Content-Type": "message/rfc822",
          "X-Envelope-To": message.to,
          "X-Envelope-From": message.from,
        },
        body: raw,
      });
      accepted = response.ok;
      if (!accepted) console.log(`Payer answered ${response.status} for mail to ${message.to}`);
    } catch (err) {
      console.log(`Could not reach Payer for mail to ${message.to}: ${err}`);
    }
    if (!accepted && env.FALLBACK_ADDRESS) {
      await message.forward(env.FALLBACK_ADDRESS);
    }
  },
};

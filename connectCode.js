// ═══════════════════════════════════════════════════════════════
// EduSmart Sync — School Connect Code
// ═══════════════════════════════════════════════════════════════
// A Connect Code is just the device email + password (auto-generated
// at school setup, never seen or typed by a human) packaged into one
// shareable string, so adding a new device is "paste one code"
// instead of "enter an email and a password someone has to invent
// and remember."
//
// This is NOT encryption — it's reversible on purpose, the same way
// sharing a Wi-Fi password is reversible. Anyone with the code can
// connect a device to that school's data, exactly as intended. The
// actual protection is Row Level Security on the backend (already
// tested extensively) plus controlling who you hand the code to —
// same threat model as a Wi-Fi password, not a secret needing
// cryptographic strength.
// ═══════════════════════════════════════════════════════════════

const CODE_PREFIX = "EDUCONNECT";

export function generateConnectCode(deviceEmail, devicePassword) {
  const payload = JSON.stringify({ e: deviceEmail, p: devicePassword });
  const encoded = typeof btoa !== "undefined"
    ? btoa(unescape(encodeURIComponent(payload)))
    : Buffer.from(payload, "utf8").toString("base64");
  // url-safe, no padding — cleaner to copy/paste and click without
  // trailing "=" characters getting accidentally dropped
  const urlSafe = encoded.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/,"");
  return `${CODE_PREFIX}-${urlSafe}`;
}

export function parseConnectCode(code) {
  const trimmed = (code||"").trim();
  if (!trimmed.startsWith(CODE_PREFIX+"-")) return null;
  const urlSafe = trimmed.slice(CODE_PREFIX.length+1);
  const base64 = urlSafe.replace(/-/g,"+").replace(/_/g,"/");
  const padded = base64 + "=".repeat((4 - base64.length % 4) % 4);
  try {
    const payload = typeof atob !== "undefined"
      ? decodeURIComponent(escape(atob(padded)))
      : Buffer.from(padded, "base64").toString("utf8");
    const { e, p } = JSON.parse(payload);
    if (!e || !p) return null;
    return { deviceEmail: e, devicePassword: p };
  } catch (err) {
    return null;
  }
}

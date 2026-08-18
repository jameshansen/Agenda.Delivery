// Feature flags shared by client and server code.

// SMS/text delivery is off until an operator wires up a sender (e.g. Twilio).
// While false, the UI hides the phone/text options and the server rejects
// "text" as a channel. To enable: implement the SMS leg (a Twilio call in
// src/lib/otp.ts + agents/base/agenda_shared/notify.py) and flip this to true.
export const SMS_ENABLED = false;

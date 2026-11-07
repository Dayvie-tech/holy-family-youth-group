import { createClient } from "npm:@supabase/supabase-js@2.102.0";
import { importPKCS8, SignJWT } from "npm:jose@5.9.6";

const APP_ID = Deno.env.get("JAAS_APP_ID") ?? "";
const KEY_ID = Deno.env.get("JAAS_API_KEY_ID") ?? "";
const PRIVATE_KEY_RAW = Deno.env.get("JAAS_PRIVATE_KEY") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ALLOWED_ORIGIN = "https://dayvie-tech.github.io";

const corsHeaders = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function unauthorized(message = "You are not authorised to join this meeting.") {
  return json({ error: message }, 403);
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);
  if (!APP_ID || !KEY_ID || !PRIVATE_KEY_RAW || !SUPABASE_URL || !SERVICE_ROLE_KEY) {
    return json({ error: "The meeting service is not fully configured." }, 500);
  }

  try {
    const body = await req.json();
    const meetingId = typeof body.meeting_id === "string" ? body.meeting_id : "";
    const guestToken = typeof body.guest_token === "string" ? body.guest_token : "";
    if (!meetingId && !/^[a-f0-9]{64}$/i.test(guestToken)) {
      return json({ error: "A meeting ID or valid guest invitation is required." }, 400);
    }

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    let meeting: any = null;
    let participantId = "";
    let participantName = "";
    let participantEmail = "";
    let moderator = false;

    if (guestToken) {
      const tokenHash = await sha256(guestToken);
      const { data: invitation, error: inviteError } = await admin
        .from("virtual_meeting_invitations")
        .select("id,guest_name,guest_email,expires_at,revoked_at,meeting_id")
        .eq("invite_token_hash", tokenHash)
        .is("revoked_at", null)
        .gt("expires_at", new Date().toISOString())
        .maybeSingle();
      if (inviteError) throw inviteError;
      if (!invitation) return unauthorized("This guest invitation is invalid, expired, or revoked.");

      const { data: meetingRow, error: meetingError } = await admin
        .from("virtual_meetings")
        .select("id,title,description,starts_at,ends_at,status,room_name,visibility,prayer_house_id")
        .eq("id", invitation.meeting_id).maybeSingle();
      if (meetingError) throw meetingError;
      meeting = meetingRow;
      if (!meeting || meeting.status !== "scheduled") return unauthorized("This meeting is no longer available.");
      participantId = invitation.id;
      participantName = invitation.guest_name || "Parish guest";
      participantEmail = invitation.guest_email || "";
    } else {
      const authHeader = req.headers.get("Authorization") || "";
      const accessToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
      if (!accessToken) return unauthorized("Please sign in before joining.");
      const { data: authData, error: authError } = await admin.auth.getUser(accessToken);
      if (authError || !authData.user) return unauthorized("Your sign-in session is invalid. Please sign in again.");
      const user = authData.user;
      participantId = user.id;
      participantEmail = user.email || "";

      const { data: profile, error: profileError } = await admin
        .from("profiles").select("full_name,display_name,membership_status,primary_prayer_house_id")
        .eq("id", user.id).maybeSingle();
      if (profileError) throw profileError;
      if (!profile || profile.membership_status !== "approved") return unauthorized("Only approved parish members can join.");

      const { data: assignments, error: assignmentError } = await admin
        .from("admin_assignments").select("access_level,prayer_house_id")
        .eq("user_id", user.id).eq("is_active", true);
      if (assignmentError) throw assignmentError;
      const isSuperAdmin = (assignments || []).some((a: any) => a.access_level === "super_admin");
      const { data: meetingRow, error: meetingError } = await admin
        .from("virtual_meetings")
        .select("id,title,description,starts_at,ends_at,status,room_name,visibility,prayer_house_id,created_by")
        .eq("id", meetingId).maybeSingle();
      if (meetingError) throw meetingError;
      meeting = meetingRow;
      if (!meeting || meeting.status !== "scheduled") return unauthorized("This meeting is no longer available.");

      const isHouseAdmin = meeting.prayer_house_id != null && (assignments || []).some(
        (a: any) => a.access_level === "prayer_house_admin" && a.prayer_house_id === meeting.prayer_house_id
      );
      const isCreator = meeting.created_by === user.id && (isSuperAdmin || isHouseAdmin);
      const isManager = isSuperAdmin || isHouseAdmin || isCreator;

      let isInvited = false;
      if (meeting.visibility === "invite_only") {
        const { data: invitation, error: invitedError } = await admin
          .from("virtual_meeting_invitations").select("id")
          .eq("meeting_id", meeting.id).eq("invited_user_id", user.id)
          .is("revoked_at", null).gt("expires_at", new Date().toISOString()).maybeSingle();
        if (invitedError) throw invitedError;
        isInvited = !!invitation;
      }

      const canView = isManager ||
        meeting.visibility === "parish" ||
        (meeting.visibility === "prayer_house" && profile.primary_prayer_house_id === meeting.prayer_house_id) ||
        isInvited;
      if (!canView) return unauthorized();

      moderator = isManager;
      participantName = profile.display_name || profile.full_name || user.user_metadata?.full_name || "Parish member";
    }

    if (!meeting.room_name) return json({ error: "This meeting has no room assigned yet. Please refresh or ask an administrator to resave it." }, 409);

    const now = Math.floor(Date.now() / 1000);
    const start = Math.floor(new Date(meeting.starts_at).getTime() / 1000);
    const end = Math.floor(new Date(meeting.ends_at).getTime() / 1000);
    if (now < start - 30 * 60) return json({ error: "The meeting room opens 30 minutes before the scheduled start." }, 403);
    if (now > end + 30 * 60) return json({ error: "This meeting has ended." }, 403);

    const privateKeyPem = PRIVATE_KEY_RAW.replace(/\\n/g, "\n").trim();
    const privateKey = await importPKCS8(privateKeyPem, "RS256");
    const payload = {
      aud: "jitsi",
      iss: "chat",
      sub: APP_ID,
      room: meeting.room_name,
      nbf: now - 10,
      exp: now + 10 * 60,
      context: {
        user: {
          id: participantId,
          name: participantName,
          email: participantEmail,
          moderator: moderator ? "true" : "false",
        },
        features: {
          livestreaming: false,
          recording: false,
          transcription: false,
          "outbound-call": false,
        },
        room: { regex: false },
      },
    };
    const jwt = await new SignJWT(payload)
      .setProtectedHeader({ alg: "RS256", kid: KEY_ID, typ: "JWT" })
      .sign(privateKey);

    return json({
      jwt,
      appId: APP_ID,
      roomName: `${APP_ID}/${meeting.room_name}`,
      meeting: {
        id: meeting.id,
        title: meeting.title,
        description: meeting.description,
        starts_at: meeting.starts_at,
        ends_at: meeting.ends_at,
      },
      participant: { name: participantName, moderator },
      expiresIn: 600,
    });
  } catch (error) {
    console.error("jaas-meeting-token error:", error instanceof Error ? error.message : "Unknown error");
    return json({ error: "Unable to prepare your secure meeting access. Please try again." }, 500);
  }
});

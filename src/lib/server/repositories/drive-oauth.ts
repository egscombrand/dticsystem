import "server-only";
import { sql } from "@/lib/server/db";
import { decryptSecret, encryptSecret } from "@/lib/server/crypto";
import { pgErrorCode } from "@/lib/server/errors";

export type DriveOAuthConnection = { connected: boolean; accountEmail: string | null; connectedAt: string | null; scope: string | null; tableReady: boolean };

const isMissingTable = (error: unknown) => pgErrorCode(error) === "42P01";

export async function getOAuthConnection(): Promise<DriveOAuthConnection> {
  try {
    const rows = await sql()<{ connected: boolean; account_email: string | null; connected_at: Date | null; scope: string | null }[]>`
      select connected, account_email, connected_at, scope from drive_oauth_connection where id = 1`;
    const r = rows[0];
    if (!r) return { connected: false, accountEmail: null, connectedAt: null, scope: null, tableReady: true };
    return { connected: r.connected, accountEmail: r.account_email, connectedAt: r.connected_at?.toISOString() ?? null, scope: r.scope, tableReady: true };
  } catch (error) {
    if (isMissingTable(error)) return { connected: false, accountEmail: null, connectedAt: null, scope: null, tableReady: false };
    throw error;
  }
}

/** Refresh token TERDEKRIPSI — hanya dipakai server-side untuk membangun klien Drive. Tidak pernah dikirim ke browser. */
export async function getDecryptedRefreshToken(): Promise<string | null> {
  const rows = await sql()<{ refresh_token_encrypted: string | null; connected: boolean }[]>`
    select refresh_token_encrypted, connected from drive_oauth_connection where id = 1`;
  const r = rows[0];
  if (!r || !r.connected || !r.refresh_token_encrypted) return null;
  return decryptSecret(r.refresh_token_encrypted);
}

export async function saveOAuthConnection(input: { accountEmail: string; refreshToken: string; scope: string }, actorId: string): Promise<void> {
  const encrypted = encryptSecret(input.refreshToken);
  await sql().begin(async (tx) => {
    await tx`
      insert into drive_oauth_connection (id, connected, account_email, refresh_token_encrypted, scope, connected_at, connected_by)
      values (1, true, ${input.accountEmail}, ${encrypted}, ${input.scope}, now(), ${actorId})
      on conflict (id) do update set
        connected = true, account_email = ${input.accountEmail}, refresh_token_encrypted = ${encrypted}, scope = ${input.scope}, connected_at = now(), connected_by = ${actorId}`;
    await tx`insert into auth_audit_log (actor_user_id, action, detail) values (${actorId}, 'drive_oauth_connected', ${tx.json({ accountEmail: input.accountEmail })})`;
  });
}

export async function disconnectOAuth(actorId: string): Promise<string | null> {
  const refreshToken = await getDecryptedRefreshToken();
  await sql().begin(async (tx) => {
    await tx`update drive_oauth_connection set connected = false, refresh_token_encrypted = null, account_email = null, scope = null where id = 1`;
    await tx`insert into auth_audit_log (actor_user_id, action, detail) values (${actorId}, 'drive_oauth_disconnected', ${tx.json({})})`;
  });
  return refreshToken;
}

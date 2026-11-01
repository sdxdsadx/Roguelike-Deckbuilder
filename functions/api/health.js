/* Cloudflare Pages Function：GET /api/health
   网页用它判断后台配没配好：db 是有没有绑定 D1 数据库（变量名 DB），admin 是有没有设后台密码（ADMIN_KEY）。 */
export async function onRequestGet({ env }) {
  return new Response(JSON.stringify({ ok: true, db: !!env.DB, admin: !!env.ADMIN_KEY }), {
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
  });
}

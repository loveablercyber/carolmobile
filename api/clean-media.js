import { query } from '../server/lib/db.js'
import { deleteFromCloudinary } from '../server/lib/integrations.js'
import { handleError, send } from '../server/lib/http.js'

export default async function handler(req, res) {
  try {
    const expected = process.env.CRON_SECRET
    if (!expected || req.headers.authorization !== `Bearer ${expected}`) {
      return send(res, 401, { error: 'Não autorizado.' })
    }

    const { rows } = await query(`
      select id, url, public_id from public.photos
      where appointment_id is null 
        and client_id is null 
        and created_at < now() - interval '2 hours'
    `)

    let deletedCount = 0
    for (const photo of rows) {
      if (photo.url) {
        await deleteFromCloudinary(photo.url).catch(err => 
          console.error("Error deleting orphan media from Cloudinary:", err.message)
        )
      }
      await query("delete from public.photos where id=$1", [photo.id])
      deletedCount++
    }

    return send(res, 200, { ok: true, cleaned: deletedCount })
  } catch (error) {
    return handleError(res, error)
  }
}

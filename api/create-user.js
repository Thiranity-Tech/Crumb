import { createClient } from '@supabase/supabase-js'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const url = process.env.VITE_SUPABASE_URL
  if (!serviceKey || !url) return res.status(500).json({ error: 'Server administrator setup is incomplete.' })
  const token = req.headers.authorization?.replace('Bearer ', '')
  const authClient = createClient(url, process.env.VITE_SUPABASE_ANON_KEY)
  const { data: { user }, error: authError } = await authClient.auth.getUser(token)
  if (authError || !user) return res.status(401).json({ error: 'Please sign in again.' })
  const admin = createClient(url, serviceKey)
  const { data: platformAdmin } = await admin.from('platform_administrators').select('user_id').eq('user_id', user.id).maybeSingle()
  if (!platformAdmin) return res.status(403).json({ error: 'Platform administrator access required.' })
  const { email, password, businessId, role } = req.body || {}
  if (!email || !password || !businessId || !['owner', 'admin', 'staff'].includes(role)) return res.status(400).json({ error: 'Email, password, workspace, and role are required.' })
  const { data: created, error: createError } = await admin.auth.admin.createUser({ email, password, email_confirm: true })
  if (createError) return res.status(400).json({ error: createError.message })
  const { error: memberError } = await admin.from('business_members').insert({ business_id: businessId, user_id: created.user.id, role })
  if (memberError) { await admin.auth.admin.deleteUser(created.user.id); return res.status(400).json({ error: memberError.message }) }
  return res.status(201).json({ message: 'Restaurant user created.' })
}

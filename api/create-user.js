import { createClient } from '@supabase/supabase-js'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const url = process.env.VITE_SUPABASE_URL
  if (!serviceKey || !url) return res.status(500).json({ error: 'Server administrator setup is incomplete.' })
  const token = req.headers.authorization?.replace('Bearer ', '')
  const authClient = createClient(url, process.env.VITE_SUPABASE_ANON_KEY, { global: { headers: { Authorization: `Bearer ${token}` } } })
  const { data: { user }, error: authError } = await authClient.auth.getUser(token)
  if (authError || !user) return res.status(401).json({ error: 'Please sign in again.' })
  const { data: isPlatformAdmin, error: roleError } = await authClient.rpc('is_platform_administrator')
  if (roleError || !isPlatformAdmin) return res.status(403).json({ error: 'Platform administrator access required.' })
  const admin = createClient(url, serviceKey)
  const { email, password, businessId, businessName, role, accessDays, accessEndsAt, action = 'user' } = req.body || {}

  if (action === 'update-access') {
    if (!businessId) return res.status(400).json({ error: 'Workspace ID is required.' })
    let newEnd = accessEndsAt
    if (!newEnd && accessDays) {
      const { data: b } = await admin.from('businesses').select('access_ends_at').eq('id', businessId).single()
      const base = b?.access_ends_at && new Date(b.access_ends_at) > new Date() ? new Date(b.access_ends_at).getTime() : Date.now()
      newEnd = new Date(base + Number(accessDays) * 86400000).toISOString()
    }
    if (!newEnd) return res.status(400).json({ error: 'Valid duration or end date is required.' })
    const { error: updateError } = await admin.from('businesses').update({ access_ends_at: newEnd }).eq('id', businessId)
    if (updateError) return res.status(400).json({ error: updateError.message })
    return res.status(200).json({ message: 'Access updated successfully.', access_ends_at: newEnd })
  }

  if (!email || !password || !['owner', 'admin', 'staff'].includes(role)) return res.status(400).json({ error: 'Email, password, and role are required.' })
  if (action === 'workspace' && (!businessName?.trim() || !Number(accessDays) || Number(accessDays) < 1)) return res.status(400).json({ error: 'Workspace name and access duration are required.' })
  if (action !== 'workspace' && !businessId) return res.status(400).json({ error: 'Workspace is required.' })
  const { data: created, error: createError } = await admin.auth.admin.createUser({ email, password, email_confirm: true })
  if (createError) return res.status(400).json({ error: createError.message })
  let workspaceId = businessId
  if (action === 'workspace') {
    const accessEndsAtCalc = new Date(Date.now() + Number(accessDays) * 86400000).toISOString()
    const { data: workspace, error: workspaceError } = await admin.from('businesses').insert({ name: businessName.trim(), owner_id: created.user.id, access_ends_at: accessEndsAtCalc }).select().single()
    if (workspaceError) { await admin.auth.admin.deleteUser(created.user.id); return res.status(400).json({ error: workspaceError.message }) }
    workspaceId = workspace.id
  }
  const { error: memberError } = await admin.from('business_members').insert({ business_id: workspaceId, user_id: created.user.id, role: action === 'workspace' ? 'owner' : role })
  if (memberError) { await admin.auth.admin.deleteUser(created.user.id); return res.status(400).json({ error: memberError.message }) }
  return res.status(201).json({ message: action === 'workspace' ? 'Workspace and owner login created.' : 'Restaurant user created.' })
}

import { createClient } from '@supabase/supabase-js'

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const url = process.env.VITE_SUPABASE_URL || 'https://hrswspaspuaxzowhxvcd.supabase.co'
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_YDbWbPQN4PgLUH7LxDiMRg_txdxRsny'

  if (!serviceKey || !url) return res.status(500).json({ error: 'Server administrator setup is incomplete.' })
  const token = req.headers.authorization?.replace('Bearer ', '')
  const authClient = createClient(url, anonKey, { global: { headers: { Authorization: `Bearer ${token}` } } })
  const { data: { user }, error: authError } = await authClient.auth.getUser(token)
  if (authError || !user) return res.status(401).json({ error: 'Please sign in again.' })
  const { data: isPlatformAdmin, error: roleError } = await authClient.rpc('is_platform_administrator')
  if (roleError || !isPlatformAdmin) return res.status(403).json({ error: 'Platform administrator access required.' })
  const admin = createClient(url, serviceKey)
  const { email, password, businessId, businessName, name, role, accessDays, accessEndsAt, action = 'user' } = req.body || {}

  if (action === 'update-workspace' || action === 'update-access') {
    if (!businessId) return res.status(400).json({ error: 'Workspace ID is required.' })
    const updates = {}
    const newName = (businessName || name || '').trim()
    if (newName) updates.name = newName

    if (accessEndsAt !== undefined) {
      updates.access_ends_at = accessEndsAt
    } else if (accessDays) {
      if (accessDays === 'unlimited') {
        updates.access_ends_at = null
      } else {
        const { data: b } = await admin.from('businesses').select('access_ends_at').eq('id', businessId).single()
        const base = b?.access_ends_at && new Date(b.access_ends_at) > new Date() ? new Date(b.access_ends_at).getTime() : Date.now()
        updates.access_ends_at = new Date(base + Number(accessDays) * 86400000).toISOString()
      }
    }

    if (Object.keys(updates).length === 0) return res.status(400).json({ error: 'No fields provided to update.' })

    const { error: updateError } = await admin.from('businesses').update(updates).eq('id', businessId)
    if (updateError) return res.status(400).json({ error: updateError.message })
    return res.status(200).json({ message: 'Workspace updated successfully.', updates })
  }

  if (action === 'stop-access') {
    if (!businessId) return res.status(400).json({ error: 'Workspace ID is required.' })
    const stoppedAt = new Date(Date.now() - 5000).toISOString()
    const { error: stopError } = await admin.from('businesses').update({ access_ends_at: stoppedAt }).eq('id', businessId)
    if (stopError) return res.status(400).json({ error: stopError.message })
    return res.status(200).json({ message: 'Workspace access stopped immediately.', access_ends_at: stoppedAt })
  }

  if (action === 'delete-workspace') {
    if (!businessId) return res.status(400).json({ error: 'Workspace ID is required.' })
    try {
      // Clean up child tables if any records exist in supabase
      await admin.from('business_members').delete().eq('business_id', businessId)
      await admin.from('sale_items').delete().eq('business_id', businessId).catch(() => {})
      await admin.from('sales').delete().eq('business_id', businessId).catch(() => {})
      await admin.from('purchases').delete().eq('business_id', businessId).catch(() => {})
      await admin.from('expenses').delete().eq('business_id', businessId).catch(() => {})
      await admin.from('products').delete().eq('business_id', businessId).catch(() => {})

      const { error: deleteError } = await admin.from('businesses').delete().eq('id', businessId)
      if (deleteError) return res.status(400).json({ error: deleteError.message })
      return res.status(200).json({ message: 'Workspace deleted permanently.' })
    } catch (err) {
      return res.status(500).json({ error: err.message || 'Failed to delete workspace.' })
    }
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

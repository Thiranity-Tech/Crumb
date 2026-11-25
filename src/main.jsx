import React, { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { supabase, configured } from './supabase'
import {
  openLocalDb,
  query,
  execute,
  backup,
  updateRecord,
  deleteRecord,
  startProductionBatch,
  completeProductionBatch,
  cancelProductionBatch,
  saveRecipe
} from './local-db'
import { printBill, saveBillPdf } from './printService'
import logoImg from './assets/logo.jpg'
import './styles.css'

const money = n => '₹' + Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmt = d => {
  if (!d) return '—'
  const dt = new Date(d)
  return isNaN(dt.getTime()) ? '—' : dt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}
const Empty = ({ children }) => <div className="empty">{children}</div>

function Login() {
  const [e, setE] = useState('')
  const [p, setP] = useState('')
  const [note, setNote] = useState('')
  const [loading, setLoading] = useState(false)

  async function go(x) {
    x.preventDefault()
    setLoading(true)
    setNote('')
    const cleanEmail = e.trim().toLowerCase()
    let { error } = await supabase.auth.signInWithPassword({ email: cleanEmail, password: p })
    if (error) setNote(error.message)
    setLoading(false)
  }

  return (
    <main className="auth">
      <div className="authbox">
        <img src={logoImg} alt="Crumb ERP Logo" className="authLogo" />
        <h1>Crumb & Co. ERP</h1>
        <p>Internet is needed only to verify your assigned login and access period. All ERP data stays on this computer.</p>
        <form onSubmit={go}>
          <input
            type="email"
            value={e}
            onChange={x => setE(x.target.value)}
            placeholder="Email address"
            required
          />
          <input
            type="password"
            value={p}
            onChange={x => setP(x.target.value)}
            placeholder="Password"
            required
          />
          <button disabled={loading}>{loading ? 'Verifying access…' : 'Sign in'}</button>
        </form>
        {note && <small style={{ color: '#e85968', display: 'block', marginTop: '10px' }}>{note}</small>}
      </div>
    </main>
  )
}

function Table({ headers, rows }) {
  return (
    <section className="tablecard">
      <table>
        <thead>
          <tr>{headers.map(x => <th key={x}>{x}</th>)}</tr>
        </thead>
        <tbody>
          {rows.length ? (
            rows.map((r, i) => (
              <tr key={i}>
                {r.map((x, j) => <td key={j}>{x}</td>)}
              </tr>
            ))
          ) : (
            <tr><td colSpan={headers.length}><Empty>No records yet.</Empty></td></tr>
          )}
        </tbody>
      </table>
    </section>
  )
}

function Admin() {
  const [bs, setBs] = useState([])
  const [w, setW] = useState({ businessName: '', email: '', password: '', accessDays: '30' })
  const [durations, setDurations] = useState({})
  const [customDates, setCustomDates] = useState({})
  const [note, setNote] = useState('')
  const [updatingId, setUpdatingId] = useState(null)
  const [showConfig, setShowConfig] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [editForm, setEditForm] = useState({ name: '', duration: 'keep', customDate: '', unlimited: false })
  const isDesktop = typeof window !== 'undefined' && window.location.protocol === 'file:'
  const [apiBaseUrl, setApiBaseUrl] = useState(() => {
    return (import.meta.env.VITE_API_BASE_URL || localStorage.getItem('crumb-api-base-url') || 'https://crumb-snowy.vercel.app').trim()
  })

  function getApiEndpoint(path) {
    if (!isDesktop) return path
    const base = (apiBaseUrl || 'https://crumb-snowy.vercel.app').trim().replace(/\/+$/, '')
    return `${base}${path}`
  }

  async function load() {
    try {
      const endpoint = getApiEndpoint('/api/create-user')
      const { data: { session } } = await supabase.auth.getSession()
      if (session?.access_token) {
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.access_token}`
          },
          body: JSON.stringify({ action: 'list-workspaces' })
        })
        const out = await res.json().catch(() => ({}))
        if (res.ok && Array.isArray(out.workspaces)) {
          setBs(out.workspaces)
          return
        }
      }
    } catch (e) {
      console.warn('API list-workspaces fallback to RPC:', e)
    }

    let { data, error } = await supabase.rpc('get_platform_businesses')
    if (error) setNote(error.message)
    else setBs(data || [])
  }

  useEffect(() => {
    load()
    if (!supabase) return
    const channel = supabase
      .channel('platform-businesses-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'businesses' }, () => {
        load()
      })
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [])

  async function send(e) {
    e.preventDefault()
    setNote('')
    const endpoint = getApiEndpoint('/api/create-user')

    try {
      let { data: { session } } = await supabase.auth.getSession()
      let r = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session?.access_token}`
        },
        body: JSON.stringify({
          ...w,
          email: w.email.trim().toLowerCase(),
          role: 'owner',
          action: 'workspace'
        })
      })
      let out = await r.json().catch(() => ({}))
      if (!r.ok) {
        throw new Error(out.error || `Server responded with status ${r.status}`)
      }
      setNote(out.message || 'Workspace created successfully!')
      setW({ businessName: '', email: '', password: '', accessDays: '30' })
      load()
    } catch (err) {
      setNote(`Creation failed: ${err.message}`)
    }
  }

  function handleStartEdit(x) {
    setEditingId(x.business_id)
    setEditForm({
      name: x.business_name || '',
      duration: 'keep',
      customDate: x.access_ends_at ? x.access_ends_at.slice(0, 10) : new Date().toISOString().slice(0, 10),
      unlimited: !x.access_ends_at
    })
    setNote('')
  }

  async function saveWorkspaceEdit(businessId) {
    const trimmedName = editForm.name.trim()
    if (!trimmedName) {
      setNote('Workspace name cannot be empty.')
      return
    }

    const currentBiz = bs.find(b => b.business_id === businessId)
    let newEndsAt = currentBiz?.access_ends_at

    if (editForm.unlimited || editForm.duration === 'unlimited') {
      newEndsAt = null
    } else if (editForm.duration === 'custom') {
      if (!editForm.customDate) {
        setNote('Please select an expiration date.')
        return
      }
      newEndsAt = new Date(editForm.customDate + 'T23:59:59').toISOString()
    } else if (typeof editForm.duration === 'string' && editForm.duration.startsWith('set-')) {
      const days = Number(editForm.duration.replace('set-', ''))
      newEndsAt = new Date(Date.now() + days * 86400000).toISOString()
    } else if (typeof editForm.duration === 'string' && editForm.duration.startsWith('add-')) {
      const days = Number(editForm.duration.replace('add-', ''))
      const base = currentBiz?.access_ends_at && new Date(currentBiz.access_ends_at) > new Date()
        ? new Date(currentBiz.access_ends_at).getTime()
        : Date.now()
      newEndsAt = new Date(base + days * 86400000).toISOString()
    } else if (editForm.duration !== 'keep') {
      const days = Number(editForm.duration)
      if (!isNaN(days) && days > 0) {
        const base = currentBiz?.access_ends_at && new Date(currentBiz.access_ends_at) > new Date()
          ? new Date(currentBiz.access_ends_at).getTime()
          : Date.now()
        newEndsAt = new Date(base + days * 86400000).toISOString()
      }
    }

    setUpdatingId(businessId)
    setNote('')

    try {
      const endpoint = getApiEndpoint('/api/create-user')
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.access_token) throw new Error('Session expired. Please sign in again.')

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`
        },
        body: JSON.stringify({
          action: 'update-workspace',
          businessId,
          businessName: trimmedName,
          accessEndsAt: newEndsAt
        })
      })
      const out = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(out.error || 'Failed to update workspace')

      // Optimistically update React state immediately
      setBs(prev => prev.map(b => {
        if (b.business_id === businessId) {
          return {
            ...b,
            business_name: trimmedName,
            access_ends_at: newEndsAt
          }
        }
        return b
      }))
      setNote(`Workspace "${trimmedName}" updated successfully.`)
      setEditingId(null)
      await load()
    } catch (err) {
      setNote(`Update failed: ${err.message}`)
    } finally {
      setUpdatingId(null)
    }
  }

  async function handleStopAccess(x) {
    if (!window.confirm(`Stop access for "${x.business_name}" immediately? Users active in this workspace will be disconnected instantly.`)) {
      return
    }

    setUpdatingId(x.business_id)
    setNote('')

    try {
      const endpoint = getApiEndpoint('/api/create-user')
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.access_token) throw new Error('Session expired. Please sign in again.')

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`
        },
        body: JSON.stringify({
          action: 'stop-access',
          businessId: x.business_id
        })
      })
      const out = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(out.error || 'Failed to stop workspace access')

      setNote(`Access for "${x.business_name}" has been stopped abruptly.`)
      await load()
    } catch (err) {
      setNote(`Stop access failed: ${err.message}`)
    } finally {
      setUpdatingId(null)
    }
  }

  async function handleDeleteWorkspace(x) {
    if (!window.confirm(`Are you sure you want to PERMANENTLY delete workspace "${x.business_name}"?\n\nThis will remove the workspace and all its members from Supabase.`)) {
      return
    }

    setUpdatingId(x.business_id)
    setNote('')

    try {
      const endpoint = getApiEndpoint('/api/create-user')
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.access_token) throw new Error('Session expired. Please sign in again.')

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`
        },
        body: JSON.stringify({
          action: 'delete-workspace',
          businessId: x.business_id
        })
      })
      const out = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(out.error || 'Failed to delete workspace')

      // Optimistically remove from local state immediately
      setBs(prev => prev.filter(b => b.business_id !== x.business_id))
      setNote(`Workspace "${x.business_name}" deleted permanently.`)
      await load()
    } catch (err) {
      setNote(`Delete failed: ${err.message}`)
    } finally {
      setUpdatingId(null)
    }
  }

  return (
    <main>
      <div className="heading">
        <div>
          <h1>Platform administrator</h1>
          <p>Login, workspace and duration control only. Client operational data is local.</p>
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <button
            type="button"
            className="btnEdit"
            style={{ padding: '8px 12px', fontSize: '12px' }}
            onClick={() => setShowConfig(!showConfig)}
          >
            ⚙️ Server URL
          </button>
          <button className="adminSignout" onClick={() => supabase.auth.signOut()}>Sign out</button>
        </div>
      </div>

      {showConfig && (
        <section className="formcard" style={{ marginBottom: '16px', background: '#f8fafc', borderColor: '#cbd5e1' }}>
          <h2 style={{ fontSize: '14px', marginBottom: '4px' }}>🔗 Backend API Endpoint</h2>
          <p style={{ color: '#64748b', fontSize: '12px', margin: '0 0 10px' }}>
            Set custom Vercel / server endpoint (e.g. <code>https://crumb-erp.vercel.app</code>) if provisioning from desktop.
          </p>
          <div style={{ display: 'flex', gap: '8px' }}>
            <input
              placeholder="https://your-deployment.vercel.app"
              value={apiBaseUrl}
              onChange={e => {
                const val = e.target.value.trim()
                setApiBaseUrl(val)
                localStorage.setItem('crumb-api-base-url', val)
              }}
              style={{ background: '#fff' }}
            />
            {apiBaseUrl && (
              <button
                type="button"
                onClick={() => {
                  setApiBaseUrl('')
                  localStorage.removeItem('crumb-api-base-url')
                }}
                style={{ padding: '6px 12px', background: '#e2e8f0', color: '#334155', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '12px' }}
              >
                Clear
              </button>
            )}
          </div>
        </section>
      )}

      <section className="formcard">
        <h2>Create new restaurant workspace</h2>
        <form className="formgrid" onSubmit={send}>
          <input
            placeholder="Restaurant / bakery name"
            value={w.businessName}
            onChange={e => setW({ ...w, businessName: e.target.value })}
            required
          />
          <input
            type="email"
            placeholder="Owner email"
            value={w.email}
            onChange={e => setW({ ...w, email: e.target.value })}
            required
          />
          <input
            type="password"
            minLength="6"
            placeholder="Owner temporary password"
            value={w.password}
            onChange={e => setW({ ...w, password: e.target.value })}
            required
          />
          <select value={w.accessDays} onChange={e => setW({ ...w, accessDays: e.target.value })}>
            <option value="7">7 days</option>
            <option value="30">30 days</option>
            <option value="90">90 days</option>
            <option value="180">6 months</option>
            <option value="365">1 year</option>
          </select>
          <button>Create workspace & owner</button>
        </form>
        {note && <p className="note" style={{ marginTop: '10px' }}>{note}</p>}
      </section>

      <section className="tablecard">
        <table>
          <thead>
            <tr>
              <th style={{ minWidth: '200px' }}>Workspace / Business</th>
              <th style={{ minWidth: '220px' }}>Client / Owner Email</th>
              <th style={{ minWidth: '190px' }}>Access Status</th>
              <th style={{ minWidth: '260px' }}>Workspace Actions</th>
            </tr>
          </thead>
          <tbody>
            {bs.length ? (
              bs.map(x => {
                const isEditing = editingId === x.business_id
                const isExpired = x.access_ends_at && new Date(x.access_ends_at) <= new Date()
                const isBusy = updatingId === x.business_id

                if (isEditing) {
                  return (
                    <tr key={x.business_id} style={{ background: '#fdfcfe' }}>
                      <td>
                        <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, color: '#6856d8', marginBottom: '4px' }}>
                          Edit Workspace Name:
                        </label>
                        <input
                          value={editForm.name}
                          onChange={e => setEditForm({ ...editForm, name: e.target.value })}
                          placeholder="Workspace name"
                          required
                          style={{ minWidth: '180px' }}
                        />
                      </td>
                      <td>
                        <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, color: '#64748b', marginBottom: '4px' }}>
                          Client Email (Login ID):
                        </label>
                        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '6px 10px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '6px' }}>
                          <span style={{ fontSize: '13px', color: '#1e293b', fontWeight: 600 }}>
                            ✉️ {x.owner_email || x.email || '—'}
                          </span>
                        </div>
                      </td>
                      <td>
                        <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, color: '#6856d8', marginBottom: '4px' }}>
                          Edit Access Duration:
                        </label>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                          <select
                            value={editForm.duration}
                            onChange={e => setEditForm({
                              ...editForm,
                              duration: e.target.value,
                              unlimited: e.target.value === 'unlimited'
                            })}
                          >
                            <option value="keep">Keep current access {x.access_ends_at ? `(${fmt(x.access_ends_at)})` : '(No limit)'}</option>
                            <option value="set-7">Set 7 days access from today</option>
                            <option value="set-30">Set 30 days access from today</option>
                            <option value="set-90">Set 90 days access from today</option>
                            <option value="set-180">Set 6 months access from today</option>
                            <option value="set-365">Set 1 year access from today</option>
                            <option value="add-7">+7 days extension</option>
                            <option value="add-30">+30 days extension</option>
                            <option value="add-90">+90 days extension</option>
                            <option value="custom">Pick exact expiry date…</option>
                            <option value="unlimited">No expiration (Unlimited)</option>
                          </select>
                          {editForm.duration === 'custom' && (
                            <input
                              type="date"
                              value={editForm.customDate}
                              onChange={e => setEditForm({ ...editForm, customDate: e.target.value })}
                              required
                            />
                          )}
                        </div>
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginTop: '16px' }}>
                          <button
                            className="btnSave"
                            disabled={isBusy}
                            onClick={() => saveWorkspaceEdit(x.business_id)}
                          >
                            {isBusy ? 'Saving…' : 'Save'}
                          </button>
                          <button
                            className="btnCancel"
                            disabled={isBusy}
                            onClick={() => setEditingId(null)}
                          >
                            Cancel
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                }

                return (
                  <tr key={x.business_id}>
                    <td>
                      <b style={{ fontSize: '15px', color: '#1e293b' }}>{x.business_name}</b>
                      <br />
                      <small style={{ color: '#64748b' }}>Created {fmt(x.created_at)}</small>
                    </td>
                    <td>
                      <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '4px 10px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '6px' }}>
                        <span style={{ fontSize: '13px', color: '#1e293b', fontWeight: 600 }}>
                          ✉️ {x.owner_email || x.email || '—'}
                        </span>
                      </div>
                    </td>
                    <td>
                      {x.access_ends_at ? (
                        isExpired ? (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', padding: '4px 10px', background: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca', borderRadius: '6px', fontWeight: 700, fontSize: '12px' }}>
                            ⛔ Expired / Stopped ({fmt(x.access_ends_at)})
                          </span>
                        ) : (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', padding: '4px 10px', background: '#ecfdf5', color: '#059669', border: '1px solid #a7f3d0', borderRadius: '6px', fontWeight: 700, fontSize: '12px' }}>
                            🟢 Active until {fmt(x.access_ends_at)}
                          </span>
                        )
                      ) : (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', padding: '4px 10px', background: '#f8fafc', color: '#475569', border: '1px solid #cbd5e1', borderRadius: '6px', fontWeight: 600, fontSize: '12px' }}>
                          ♾️ No limit
                        </span>
                      )}
                    </td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                        <button
                          className="btnEdit"
                          disabled={isBusy}
                          onClick={() => handleStartEdit(x)}
                          title="Edit workspace name & access expiration"
                        >
                          ✏️ Edit
                        </button>
                        {!isExpired ? (
                          <button
                            className="btnStop"
                            disabled={isBusy}
                            onClick={() => handleStopAccess(x)}
                            title="Abruptly stop client access right now"
                          >
                            {isBusy ? 'Stopping…' : '⛔ Stop Access'}
                          </button>
                        ) : (
                          <button
                            className="tableActionBtn"
                            style={{ padding: '6px 12px', fontSize: '12px' }}
                            disabled={isBusy}
                            onClick={() => handleStartEdit(x)}
                            title="Renew expired access"
                          >
                            ▶️ Renew
                          </button>
                        )}
                        <button
                          className="btnDelete"
                          disabled={isBusy}
                          onClick={() => handleDeleteWorkspace(x)}
                          title="Permanently delete workspace and its members"
                        >
                          {isBusy ? 'Deleting…' : '🗑️ Delete'}
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })
            ) : (
              <tr><td colSpan={4}><Empty>No records yet.</Empty></td></tr>
            )}
          </tbody>
        </table>
      </section>
    </main>
  )
}

function Restaurant({ business }) {
  const [data, setData] = useState({
    products: [],
    ingredients: [],
    recipes: [],
    production_batches: [],
    employees: [],
    attendance: [],
    purchases: [],
    expenses: [],
    sales: [],
    items: []
  })
  const [view, setView] = useState('Dashboard')
  const [cart, setCart] = useState([])
  const [pass, setPass] = useState('')
  const [note, setNote] = useState('')

  const [inventoryTab, setInventoryTab] = useState('packed')
  const [purchaseDest, setPurchaseDest] = useState('ingredients')
  const [editProd, setEditProd] = useState(null)
  const [editIng, setEditIng] = useState(null)
  const [editPurchase, setEditPurchase] = useState(null)
  const [editExpense, setEditExpense] = useState(null)
  const [editEmployee, setEditEmployee] = useState(null)
  const [editAttendance, setEditAttendance] = useState(null)
  const [receiptModal, setReceiptModal] = useState(null)
  const [autoPrint, setAutoPrint] = useState(false)

  // Production / Recipe state
  const [prodModal, setProdModal] = useState(null)
  const [recipeName, setRecipeName] = useState('')
  const [recipeIngredients, setRecipeIngredients] = useState([{ name: '', quantity: 1, unit: 'Kg' }])

  async function load() {
    let [products, ingredients, recipes, production_batches, employees, attendance, purchases, expenses, sales, items] = await Promise.all([
      query('select * from products order by name'),
      query('select * from ingredients order by name'),
      query('select * from recipes order by name'),
      query('select * from production_batches order by started_at desc'),
      query('select * from employees order by name'),
      query('select * from attendance order by date desc'),
      query('select * from purchases order by purchased_at desc'),
      query('select * from expenses order by expense_at desc'),
      query('select * from sales order by sold_at desc'),
      query('select * from sale_items')
    ])
    setData({ products, ingredients, recipes, production_batches, employees, attendance, purchases, expenses, sales, items })
    setCart(prev => prev.filter(c => products.some(p => String(p.id) === String(c.id))))
  }

  useEffect(() => {
    openLocalDb().then(load)
  }, [])

  async function addProduct(e) {
    e.preventDefault()
    let f = new FormData(e.target)
    await execute('insert into products(name,selling_price,quantity) values(?,?,?)', [
      f.get('name')?.toString().trim(),
      Number(f.get('price')) || 0,
      Number(f.get('quantity')) || 0
    ])
    e.target.reset()
    await load()
  }

  async function saveProductEdit(id) {
    if (!editProd || !editProd.name.trim()) return
    await updateRecord('products', id, {
      name: editProd.name.trim(),
      selling_price: Number(editProd.price) || 0,
      price: Number(editProd.price) || 0,
      quantity: Number(editProd.quantity) || 0
    })
    setEditProd(null)
    await load()
  }

  async function deleteProduct(id) {
    if (!window.confirm('Delete this product from inventory? It will also be removed from the billing menu.')) return
    await deleteRecord('products', id)
    setCart(prev => prev.filter(c => String(c.id) !== String(id)))
    if (editProd?.id === id) setEditProd(null)
    await load()
  }

  async function handleStartBatch(e) {
    if (e) e.preventDefault()
    const cleanName = recipeName.trim()
    if (!cleanName) {
      alert('Please enter a recipe / product name')
      return
    }
    const cleanIngredients = recipeIngredients.filter(i => (i.name || '').trim() && Number(i.quantity) > 0)
    if (!cleanIngredients.length) {
      alert('Please select at least one ingredient with a valid quantity.')
      return
    }

    await startProductionBatch({
      recipe_name: cleanName,
      ingredients: cleanIngredients
    })

    setRecipeName('')
    setRecipeIngredients([{ name: '', quantity: 1, unit: 'Kg' }])
    await load()
    setNote(`Batch "${cleanName}" started and marked as Preparing! Ingredients were consumed from stock.`)
  }

  async function handleSaveRecipeTemplate() {
    const cleanName = recipeName.trim()
    if (!cleanName) {
      alert('Please enter a recipe name to save.')
      return
    }
    const cleanIngredients = recipeIngredients.filter(i => (i.name || '').trim() && Number(i.quantity) > 0)
    await saveRecipe({
      name: cleanName,
      ingredients: cleanIngredients
    })
    await load()
    setNote(`Recipe template "${cleanName}" saved successfully.`)
  }

  async function handleCompleteBatch() {
    if (!prodModal) return
    const qty = Math.max(1, Number(prodModal.quantity) || 1)
    const price = Number(prodModal.price) || 0

    await completeProductionBatch(prodModal.batch.id, {
      produced_quantity: qty,
      selling_price: price
    })

    const name = prodModal.batch.recipe_name
    setProdModal(null)
    await load()
    setNote(`✓ Finished batch: "${name}" (+${qty} pieces) added to Packed Items and available in Billing!`)
  }

  async function handleCancelBatch(batchId) {
    if (!window.confirm('Cancel this preparation batch? The consumed ingredients will be restored back to stock.')) return
    await cancelProductionBatch(batchId)
    await load()
    setNote('Preparation batch cancelled. Consumed ingredients restored.')
  }

  async function addIngredient(e) {
    e.preventDefault()
    let f = new FormData(e.target)
    const cost = Number(f.get('cost')) || 0
    await execute('insert into ingredients(name,quantity,unit,total_cost,updated_at) values(?,?,?,?,?)', [
      f.get('name')?.toString().trim(),
      Number(f.get('quantity')) || 0,
      f.get('unit') || 'Piece',
      cost,
      new Date().toISOString()
    ])
    e.target.reset()
    await load()
  }

  async function saveIngredientEdit(id) {
    if (!editIng || !editIng.name.trim()) return
    await updateRecord('ingredients', id, {
      name: editIng.name.trim(),
      quantity: Number(editIng.quantity) || 0,
      unit: editIng.unit || 'Piece',
      total_cost: Number(editIng.cost) || 0
    })
    setEditIng(null)
    await load()
  }

  async function deleteIngredient(id) {
    if (!window.confirm('Delete this ingredient from inventory?')) return
    await deleteRecord('ingredients', id)
    if (editIng?.id === id) setEditIng(null)
    await load()
  }

  async function addEmployee(e) {
    e.preventDefault()
    let f = new FormData(e.target)
    await execute('insert into employees(name,job,phone,created_at) values(?,?,?,?)', [
      f.get('name')?.toString().trim(),
      f.get('job')?.toString().trim(),
      f.get('phone')?.toString().trim(),
      new Date().toISOString()
    ])
    e.target.reset()
    await load()
  }

  async function saveEmployeeEdit(id) {
    if (!editEmployee || !editEmployee.name.trim()) return
    await updateRecord('employees', id, {
      name: editEmployee.name.trim(),
      job: (editEmployee.job || '').trim(),
      phone: (editEmployee.phone || '').trim()
    })
    setEditEmployee(null)
    await load()
  }

  async function deleteEmployee(id) {
    if (!window.confirm('Delete this employee?')) return
    await deleteRecord('employees', id)
    if (editEmployee?.id === id) setEditEmployee(null)
    await load()
  }

  async function addAttendance(e) {
    e.preventDefault()
    let f = new FormData(e.target)
    const empId = f.get('employee_id')
    const emp = data.employees.find(x => String(x.id) === String(empId))
    const empName = emp ? emp.name : 'Staff'
    const dateVal = f.get('date') || new Date().toISOString().split('T')[0]
    const statusVal = f.get('status') || 'Full day'

    await execute('insert into attendance(employee_id,employee_name,date,status,created_at) values(?,?,?,?,?)', [
      empId,
      empName,
      dateVal,
      statusVal,
      new Date().toISOString()
    ])
    e.target.reset()
    await load()
  }

  async function saveAttendanceEdit(id) {
    if (!editAttendance) return
    const emp = data.employees.find(x => String(x.id) === String(editAttendance.employee_id))
    await updateRecord('attendance', id, {
      employee_id: editAttendance.employee_id,
      employee_name: emp ? emp.name : editAttendance.employee_name,
      date: editAttendance.date,
      status: editAttendance.status
    })
    setEditAttendance(null)
    await load()
  }

  async function deleteAttendance(id) {
    if (!window.confirm('Delete this attendance record?')) return
    await deleteRecord('attendance', id)
    if (editAttendance?.id === id) setEditAttendance(null)
    await load()
  }

  async function addPurchase(e) {
    e.preventDefault()
    let f = new FormData(e.target)
    const destination = f.get('destination') || purchaseDest || 'ingredients'
    const name = f.get('name')?.toString().trim()
    const quantity = Number(f.get('quantity')) || 1
    const unit = f.get('unit') || 'Piece'
    const cost = Number(f.get('cost')) || 0

    await execute('insert into purchases(product_name,quantity,unit,total_cost,purchased_at,destination) values(?,?,?,?,?,?)', [
      name,
      quantity,
      unit,
      cost,
      new Date().toISOString(),
      destination
    ])
    e.target.reset()
    await load()
    setNote(`✓ Purchase recorded: "${name}" (+${quantity} ${unit}) added to ${destination === 'packed' ? 'Packed Goods (Billing)' : 'Ingredients'}!`)
  }

  async function savePurchaseEdit(id) {
    if (!editPurchase || !editPurchase.product_name.trim()) return
    await updateRecord('purchases', id, {
      product_name: editPurchase.product_name.trim(),
      name: editPurchase.product_name.trim(),
      quantity: Number(editPurchase.quantity) || 1,
      unit: editPurchase.unit,
      total_cost: Number(editPurchase.cost) || 0,
      cost: Number(editPurchase.cost) || 0,
      destination: editPurchase.destination || 'ingredients'
    })
    setEditPurchase(null)
    await load()
    setNote('Purchase record updated successfully.')
  }

  async function deletePurchase(id) {
    if (!window.confirm('Delete this purchase record? Dashboard profit/loss and ingredient stock will update automatically.')) return
    await deleteRecord('purchases', id)
    if (editPurchase?.id === id) setEditPurchase(null)
    await load()
  }

  async function addExpense(e) {
    e.preventDefault()
    let f = new FormData(e.target)
    await execute('insert into expenses(description,amount,expense_at) values(?,?,?)', [
      f.get('description')?.toString().trim(),
      Number(f.get('amount')) || 0,
      new Date().toISOString()
    ])
    e.target.reset()
    await load()
  }

  async function saveExpenseEdit(id) {
    if (!editExpense || !editExpense.description.trim()) return
    await updateRecord('expenses', id, {
      description: editExpense.description.trim(),
      amount: Number(editExpense.amount) || 0
    })
    setEditExpense(null)
    await load()
  }

  async function deleteExpense(id) {
    if (!window.confirm('Delete this expense record? Dashboard profit/loss will update automatically.')) return
    await deleteRecord('expenses', id)
    if (editExpense?.id === id) setEditExpense(null)
    await load()
  }

  const add = p => {
    const sp = Number(p.selling_price != null ? p.selling_price : (p.price != null ? p.price : 0))
    let x = cart.find(i => String(i.id) === String(p.id))
    setCart(x
      ? cart.map(i => String(i.id) === String(p.id) ? { ...i, quantity: i.quantity + 1, selling_price: sp, price: sp } : i)
      : [...cart, { ...p, selling_price: sp, price: sp, quantity: 1 }]
    )
  }

  async function bill() {
    if (!cart.length) return
    const custEl = document.querySelector('#customer')
    const phoneEl = document.querySelector('#phone')
    const payEl = document.querySelector('#pay')
    const custName = custEl?.value?.trim() || ''
    const custPhone = phoneEl?.value?.trim() || ''
    const payMethod = payEl?.value || 'Cash'
    const total = cart.reduce((a, x) => a + x.quantity * (x.selling_price ?? x.price ?? 0), 0)
    const saleDate = new Date().toISOString()
    await execute('insert into sales(customer_name,customer_phone,payment_method,subtotal,total,sold_at) values(?,?,?,?,?,?)', [
      custName,
      custPhone,
      payMethod,
      total,
      total,
      saleDate
    ])
    const s = (await query('select last_insert_rowid() as id'))[0]
    const billItems = []
    for (let x of cart) {
      const uPrice = x.selling_price ?? x.price ?? 0
      await execute('insert into sale_items(sale_id,product_name,unit_price,quantity) values(?,?,?,?)', [
        s.id,
        x.name,
        uPrice,
        x.quantity
      ])
      billItems.push({
        name: x.name,
        quantity: x.quantity,
        price: uPrice,
        total: x.quantity * uPrice
      })
      // Deduct sold quantity from Packed Item stock
      const prod = data.products.find(p => String(p.id) === String(x.id))
      if (prod) {
        const remaining = Math.max(0, (Number(prod.quantity) || 0) - x.quantity)
        await updateRecord('products', prod.id, { quantity: remaining })
      }
    }

    const completedInvoice = {
      id: s.id,
      customer_name: custName,
      customer_phone: custPhone,
      payment_method: payMethod,
      subtotal: total,
      total: total,
      sold_at: saleDate,
      items: billItems
    }

    setCart([])
    if (custEl) custEl.value = ''
    if (phoneEl) phoneEl.value = ''
    await load()

    if (autoPrint) {
      await printBill(completedInvoice, { name: business.name })
    }
    setReceiptModal(completedInvoice)
  }

  async function change(e) {
    e.preventDefault()
    let { error } = await supabase.auth.updateUser({ password: pass })
    setNote(error?.message || 'Password updated.')
    if (!error) setPass('')
  }

  async function doBackup() {
    let result = await backup()
    setNote(result ? `Backup saved: ${result}` : 'Backups are available in the Windows desktop app.')
  }

  let revenue = data.sales.reduce((a, x) => a + Number(x.total || 0), 0)
  let expense = data.expenses.reduce((a, x) => a + Number(x.amount || 0), 0)
  let purchase = data.purchases.reduce((a, x) => a + Number(x.total_cost != null ? x.total_cost : (x.cost != null ? x.cost : 0)), 0)
  let profitLoss = revenue - purchase - expense
  let sold = data.items.reduce((a, x) => a + Number(x.quantity || 0), 0)

  let Layout = ({ title, children }) => (
    <>
      <div className="heading">
        <div>
          <h1>{title}</h1>
          <p>{business.name} · {fmt(new Date())}</p>
        </div>
      </div>
      {children}
    </>
  )

  let Form = ({ title, children, onSubmit }) => (
    <section className="formcard">
      <h2>{title}</h2>
      <form className="formgrid" onSubmit={onSubmit}>
        {children}
        <button>Save</button>
      </form>
    </section>
  )

  const pages = {
    Dashboard: () => (
      <Layout title="Dashboard">
        <div className="metrics">
          <div className="metric">
            <small>PRODUCTS SOLD</small>
            <strong>{sold}</strong>
            <span>items in completed bills</span>
          </div>
          <div className="metric">
            <small>SALES REVENUE</small>
            <strong>{money(revenue)}</strong>
            <span>sum of completed bills</span>
          </div>
          <div className="metric">
            <small>PROFIT / LOSS</small>
            <strong style={{ color: profitLoss >= 0 ? '#1ba471' : '#e85968' }}>
              {profitLoss >= 0 ? money(profitLoss) : `− ${money(Math.abs(profitLoss))}`}
            </strong>
            <span style={{ color: profitLoss >= 0 ? '#1ba471' : '#e85968' }}>
              sales revenue − purchases − expenses
            </span>
          </div>
          <div className="metric">
            <small>EXPENSES</small>
            <strong>{money(expense)}</strong>
            <span>from expense records</span>
          </div>
        </div>
        <div className="two">
          <section>
            <h2>Menu products</h2>
            {data.products.slice(0, 5).map(x => (
              <div className="row" key={x.id}>
                <b>{x.name}</b>
                <span>{money(x.selling_price ?? x.price)}</span>
              </div>
            ))}
            {!data.products.length && <Empty>No products yet.</Empty>}
          </section>
          <section>
            <h2>Recent sales</h2>
            {data.sales.slice(0, 5).map(x => (
              <div className="row" key={x.id}>
                <b>Bill #{x.id}</b>
                <span>{money(x.total)}</span>
              </div>
            ))}
            {!data.sales.length && <Empty>No bills yet.</Empty>}
          </section>
        </div>
      </Layout>
    ),
    'Billing / POS': () => {
      let total = cart.reduce((a, x) => a + x.quantity * (x.selling_price ?? x.price ?? 0), 0)
      return (
        <Layout title="Billing / POS">
          <div className="pos">
            <section>
              <div className="products">
                {data.products.map(p => (
                  <button className="prod" onClick={() => add(p)} key={p.id}>
                    <b>{p.name}</b>
                    <small>Menu item</small>
                    <span className={`prodStock ${Number(p.quantity || 0) > 0 ? 'in' : 'out'}`}>
                      {Number(p.quantity || 0) > 0 ? `${p.quantity} in stock` : '0 in stock'}
                    </span>
                    <strong>{money(p.selling_price ?? p.price)}</strong>
                  </button>
                ))}
                {!data.products.length && <Empty>Add products in Inventory to start billing.</Empty>}
              </div>
            </section>
            <section className="cart">
              <h2>Cart ({cart.reduce((a, x) => a + x.quantity, 0)} items)</h2>
              {cart.map(x => (
                <div className="cartrow" key={x.id}>
                  <div>
                    <b>{x.name}</b>
                    <small>{money(x.selling_price ?? x.price)} each</small>
                  </div>
                  <div>
                    <button onClick={() => setCart(cart.map(i => i.id === x.id ? { ...i, quantity: i.quantity - 1 } : i).filter(i => i.quantity))}>−</button>
                    {x.quantity}
                    <button onClick={() => add(x)}>+</button>
                    <b>{money(x.quantity * (x.selling_price ?? x.price ?? 0))}</b>
                  </div>
                </div>
              ))}
              {!cart.length && <Empty>Click products to add to cart.</Empty>}
              <div className="formgrid" style={{ marginTop: '12px' }}>
                <input id="customer" placeholder="Customer (optional)" />
                <input id="phone" placeholder="Phone (optional)" />
                <select id="pay">
                  <option>Cash</option>
                  <option>UPI</option>
                  <option>Card</option>
                </select>
              </div>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', color: '#718097', marginTop: '10px', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={autoPrint}
                  onChange={e => setAutoPrint(e.target.checked)}
                  style={{ width: 'auto' }}
                />
                Auto-print bill receipt
              </label>
              <div className="total">
                <span>Total</span>
                <b>{money(total)}</b>
              </div>
              <button onClick={bill} disabled={!cart.length}>Complete sale · {money(total)}</button>
            </section>
          </div>
        </Layout>
      )
    },
    Inventory: () => (
      <Layout title="Inventory">
        <div className="inventoryTabs">
          <button
            type="button"
            className={`inventoryTabBtn ${inventoryTab === 'packed' ? 'active' : ''}`}
            onClick={() => setInventoryTab('packed')}
          >
            📦 Packed Items ({data.products.length})
          </button>
          <button
            type="button"
            className={`inventoryTabBtn ${inventoryTab === 'ingredients' ? 'active' : ''}`}
            onClick={() => setInventoryTab('ingredients')}
          >
            🌾 Ingredients & Raw Materials ({data.ingredients.length})
          </button>
        </div>

        {inventoryTab === 'packed' ? (
          <>
            <Form title="Add packed item (Menu)" onSubmit={addProduct}>
              <input name="name" placeholder="Item name (e.g. Butter Croissant)" required />
              <input name="quantity" type="number" min="0" step="1" placeholder="Initial stock quantity (default 0)" />
              <input name="price" type="number" min="0" step="any" placeholder="Selling price ₹" required />
            </Form>
            <section className="tablecard">
              <table>
                <thead>
                  <tr>
                    <th>Packed Item (Menu)</th>
                    <th>In-Stock Quantity</th>
                    <th>Selling price</th>
                    <th style={{ width: '180px' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {data.products.length ? (
                    data.products.map(p => {
                      const isEditing = editProd?.id === p.id
                      return (
                        <tr key={p.id}>
                          <td>
                            {isEditing ? (
                              <input
                                value={editProd.name}
                                onChange={e => setEditProd({ ...editProd, name: e.target.value })}
                                placeholder="Item name"
                                required
                              />
                            ) : (
                              <b>{p.name}</b>
                            )}
                          </td>
                          <td>
                            {isEditing ? (
                              <input
                                type="number"
                                min="0"
                                step="1"
                                value={editProd.quantity ?? 0}
                                onChange={e => setEditProd({ ...editProd, quantity: e.target.value })}
                                style={{ width: '80px' }}
                              />
                            ) : (
                              <span className={Number(p.quantity || 0) <= 0 ? 'stockOut' : 'stockIn'}>
                                {p.quantity || 0} Pieces
                              </span>
                            )}
                          </td>
                          <td>
                            {isEditing ? (
                              <input
                                type="number"
                                min="0"
                                step="any"
                                value={editProd.price}
                                onChange={e => setEditProd({ ...editProd, price: e.target.value })}
                                placeholder="Selling price ₹"
                                style={{ width: '110px' }}
                                required
                              />
                            ) : (
                              money(p.selling_price ?? p.price)
                            )}
                          </td>
                          <td>
                            {isEditing ? (
                              <>
                                <button className="btnSave" onClick={() => saveProductEdit(p.id)}>Save</button>
                                <button className="btnCancel" onClick={() => setEditProd(null)}>Cancel</button>
                              </>
                            ) : (
                              <>
                                <button
                                  className="btnEdit"
                                  onClick={() => setEditProd({
                                    id: p.id,
                                    name: p.name,
                                    price: p.selling_price ?? p.price ?? 0,
                                    quantity: p.quantity || 0
                                  })}
                                >
                                  Edit
                                </button>
                                <button className="btnDelete" onClick={() => deleteProduct(p.id)}>Delete</button>
                              </>
                            )}
                          </td>
                        </tr>
                      )
                    })
                  ) : (
                    <tr><td colSpan={4}><Empty>No packed items yet. Add sellable menu products above.</Empty></td></tr>
                  )}
                </tbody>
              </table>
            </section>
          </>
        ) : (
          <>
            <div className="inventoryInfoBanner">
              <span>💡</span>
              <div>
                <b>Automated Sync with Product Purchase:</b> All items purchased under <b>Product Purchase</b> are automatically stored and stock-updated here. You can also manually add or adjust ingredient stock below.
              </div>
            </div>
            <Form title="Add ingredient / raw material" onSubmit={addIngredient}>
              <input name="name" placeholder="Ingredient name (e.g. Flour, Butter, Yeast)" required />
              <input name="quantity" type="number" min="0" step="any" placeholder="Initial stock quantity" required />
              <select name="unit">
                <option>Piece</option>
                <option>Kg</option>
                <option>Gram</option>
                <option>Litre</option>
                <option>Box</option>
                <option>Pack</option>
              </select>
              <input name="cost" type="number" min="0" step="any" placeholder="Estimated / total cost ₹" />
            </Form>
            <section className="tablecard">
              <table>
                <thead>
                  <tr>
                    <th>Ingredient / Raw Material</th>
                    <th>In-Stock Quantity</th>
                    <th>Unit</th>
                    <th>Total Value / Cost</th>
                    <th>Last Updated</th>
                    <th style={{ width: '180px' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {data.ingredients.length ? (
                    data.ingredients.map(ing => {
                      const isEditing = editIng?.id === ing.id
                      const qty = Number(ing.quantity || 0)
                      return (
                        <tr key={ing.id}>
                          <td>
                            {isEditing ? (
                              <input
                                value={editIng.name}
                                onChange={e => setEditIng({ ...editIng, name: e.target.value })}
                                placeholder="Ingredient name"
                                required
                              />
                            ) : (
                              <b>{ing.name}</b>
                            )}
                          </td>
                          <td>
                            {isEditing ? (
                              <input
                                type="number"
                                min="0"
                                step="any"
                                value={editIng.quantity}
                                onChange={e => setEditIng({ ...editIng, quantity: e.target.value })}
                                style={{ width: '90px' }}
                                required
                              />
                            ) : (
                              <span className={qty <= 0 ? 'stockOut' : (qty < 5 ? 'stockLow' : 'stockIn')}>
                                {qty}
                              </span>
                            )}
                          </td>
                          <td>
                            {isEditing ? (
                              <select
                                value={editIng.unit}
                                onChange={e => setEditIng({ ...editIng, unit: e.target.value })}
                                style={{ width: '100px' }}
                              >
                                <option>Piece</option>
                                <option>Kg</option>
                                <option>Gram</option>
                                <option>Litre</option>
                                <option>Box</option>
                                <option>Pack</option>
                              </select>
                            ) : (
                              <span className="unitBadge">{ing.unit || 'Piece'}</span>
                            )}
                          </td>
                          <td>
                            {isEditing ? (
                              <input
                                type="number"
                                min="0"
                                step="any"
                                value={editIng.cost}
                                onChange={e => setEditIng({ ...editIng, cost: e.target.value })}
                                style={{ width: '110px' }}
                              />
                            ) : (
                              money(ing.total_cost || 0)
                            )}
                          </td>
                          <td>{fmt(ing.updated_at)}</td>
                          <td>
                            {isEditing ? (
                              <>
                                <button className="btnSave" onClick={() => saveIngredientEdit(ing.id)}>Save</button>
                                <button className="btnCancel" onClick={() => setEditIng(null)}>Cancel</button>
                              </>
                            ) : (
                              <>
                                <button
                                  className="btnEdit"
                                  onClick={() => setEditIng({
                                    id: ing.id,
                                    name: ing.name,
                                    quantity: ing.quantity,
                                    unit: ing.unit || 'Piece',
                                    cost: ing.total_cost || 0
                                  })}
                                >
                                  Edit
                                </button>
                                <button className="btnDelete" onClick={() => deleteIngredient(ing.id)}>Delete</button>
                              </>
                            )}
                          </td>
                        </tr>
                      )
                    })
                  ) : (
                    <tr><td colSpan={6}><Empty>No ingredients recorded yet. Purchases in "Product Purchase" will automatically appear here.</Empty></td></tr>
                  )}
                </tbody>
              </table>
            </section>
          </>
        )}
      </Layout>
    ),
    'Kitchen / Production': () => {
      const activeBatches = data.production_batches.filter(b => b.status === 'Preparing')
      const completedBatches = data.production_batches.filter(b => b.status !== 'Preparing')

      return (
        <Layout title="Kitchen / Production">
          {/* Section 1: Active Batches being prepared */}
          <section style={{ marginBottom: '20px' }}>
            <h2>🍳 Active Batches (Currently Preparing)</h2>
            <p style={{ color: '#718097', fontSize: '13px', margin: '-8px 0 16px' }}>
              Batches in oven / kitchen. When finished baking or preparing, click <b>Mark as Done</b> to specify produced units and transfer to Packed Items for Billing.
            </p>
            {activeBatches.length ? (
              <div className="batchGrid">
                {activeBatches.map(b => (
                  <div className="batchCard" key={b.id}>
                    <div className="batchHeader">
                      <div>
                        <h3 className="batchTitle">{b.recipe_name}</h3>
                        <span className="batchTime">Started: {fmt(b.started_at)}</span>
                      </div>
                      <span className="statusPreparing">⏳ Preparing</span>
                    </div>

                    <div className="batchIngredients">
                      <small>Ingredients Consumed:</small>
                      {b.ingredients && b.ingredients.length ? (
                        b.ingredients.map((ing, idx) => (
                          <div key={idx} style={{ display: 'flex', justifyContent: 'space-between' }}>
                            <span>• {ing.name}</span>
                            <b>{ing.quantity} {ing.unit || ''}</b>
                          </div>
                        ))
                      ) : (
                        <span>No ingredients specified</span>
                      )}
                    </div>

                    <div className="batchActions">
                      <button
                        className="btnDoneBatch"
                        onClick={() => {
                          const existing = data.products.find(p => (p.name || '').toLowerCase() === (b.recipe_name || '').toLowerCase())
                          setProdModal({
                            batch: b,
                            quantity: 1,
                            price: existing ? (existing.selling_price ?? existing.price ?? '') : ''
                          })
                        }}
                      >
                        ✓ Mark as Done
                      </button>
                      <button
                        className="btnCancelBatch"
                        onClick={() => handleCancelBatch(b.id)}
                        title="Cancel batch and restore ingredients"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <Empty>No active batches currently preparing. Build a recipe process below to start cooking.</Empty>
            )}
          </section>

          {/* Section 2: Recipe / Process Builder */}
          <section className="formcard" style={{ maxWidth: '100%', marginBottom: '20px' }}>
            <h2>📝 Recipe & Process Builder</h2>
            <p style={{ color: '#718097', fontSize: '13px', margin: '-8px 0 16px' }}>
              Select raw ingredients from Inventory, specify quantities, and start preparation. The consumed ingredients will be automatically deducted from your stock.
            </p>

            {data.recipes.length > 0 && (
              <div style={{ display: 'flex', gap: '10px', alignItems: 'center', marginBottom: '14px', background: '#f8fafc', padding: '10px 14px', borderRadius: '8px' }}>
                <span style={{ fontSize: '13px', fontWeight: 600, color: '#475569' }}>Load Saved Recipe Template:</span>
                <select
                  style={{ width: 'auto', flex: 1, maxWidth: '280px' }}
                  onChange={e => {
                    const r = data.recipes.find(x => String(x.id) === e.target.value)
                    if (r) {
                      setRecipeName(r.name)
                      if (r.ingredients && r.ingredients.length) {
                        setRecipeIngredients(r.ingredients.map(i => ({ ...i })))
                      }
                    }
                  }}
                  defaultValue=""
                >
                  <option value="" disabled>-- Select a saved recipe --</option>
                  {data.recipes.map(r => (
                    <option key={r.id} value={r.id}>{r.name} ({r.ingredients?.length || 0} ingredients)</option>
                  ))}
                </select>
              </div>
            )}

            <form onSubmit={handleStartBatch}>
              <div style={{ marginBottom: '12px' }}>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#475569', marginBottom: '4px' }}>
                  Product / Recipe Name:
                </label>
                <input
                  value={recipeName}
                  onChange={e => setRecipeName(e.target.value)}
                  placeholder="e.g. Butter Croissant, Sourdough Loaf, Chocolate Muffin"
                  required
                />
              </div>

              <div style={{ marginBottom: '12px' }}>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#475569', marginBottom: '6px' }}>
                  Ingredients from Inventory:
                </label>
                {recipeIngredients.map((row, index) => {
                  return (
                    <div className="recipeRow" key={index}>
                      <select
                        value={row.name}
                        onChange={e => {
                          const val = e.target.value
                          const targetIng = data.ingredients.find(i => i.name === val)
                          const updated = [...recipeIngredients]
                          updated[index] = {
                            ...updated[index],
                            name: val,
                            unit: targetIng?.unit || updated[index].unit
                          }
                          setRecipeIngredients(updated)
                        }}
                        required
                        style={{ flex: 2 }}
                      >
                        <option value="" disabled>-- Choose ingredient --</option>
                        {data.ingredients.map(ing => (
                          <option key={ing.id} value={ing.name}>
                            {ing.name} ({ing.quantity} {ing.unit || 'Piece'} in stock)
                          </option>
                        ))}
                      </select>

                      <input
                        type="number"
                        min="0.001"
                        step="any"
                        placeholder="Quantity"
                        value={row.quantity}
                        onChange={e => {
                          const updated = [...recipeIngredients]
                          updated[index] = { ...updated[index], quantity: e.target.value }
                          setRecipeIngredients(updated)
                        }}
                        style={{ width: '100px' }}
                        required
                      />

                      <select
                        value={row.unit}
                        onChange={e => {
                          const updated = [...recipeIngredients]
                          updated[index] = { ...updated[index], unit: e.target.value }
                          setRecipeIngredients(updated)
                        }}
                        style={{ width: '100px' }}
                      >
                        <option>Piece</option>
                        <option>Kg</option>
                        <option>Gram</option>
                        <option>Litre</option>
                        <option>Box</option>
                        <option>Pack</option>
                      </select>

                      {recipeIngredients.length > 1 && (
                        <button
                          type="button"
                          className="btnDelete"
                          onClick={() => setRecipeIngredients(recipeIngredients.filter((_, i) => i !== index))}
                          style={{ padding: '8px 12px' }}
                        >
                          ✕
                        </button>
                      )}
                    </div>
                  )
                })}

                <button
                  type="button"
                  onClick={() => setRecipeIngredients([...recipeIngredients, { name: '', quantity: 1, unit: 'Kg' }])}
                  style={{
                    background: '#f1f5f9',
                    color: '#475569',
                    border: '1px dashed #cbd5e1',
                    borderRadius: '6px',
                    padding: '8px 14px',
                    fontSize: '12px',
                    fontWeight: 700,
                    cursor: 'pointer',
                    marginTop: '6px'
                  }}
                >
                  + Add Ingredient
                </button>
              </div>

              <div style={{ display: 'flex', gap: '10px', marginTop: '16px' }}>
                <button
                  type="submit"
                  style={{ background: '#6856d8', color: '#fff', border: 0, padding: '12px 20px', borderRadius: '8px', fontWeight: 700, cursor: 'pointer' }}
                >
                  🍳 Start Preparing (Mark Batch as Preparing)
                </button>
                <button
                  type="button"
                  onClick={handleSaveRecipeTemplate}
                  style={{ background: '#f8fafc', border: '1px solid #dce2eb', color: '#475569', padding: '12px 16px', borderRadius: '8px', fontWeight: 700, cursor: 'pointer' }}
                >
                  💾 Save as Recipe Template
                </button>
              </div>
            </form>
          </section>

          {/* Section 3: Completed Production Batches */}
          <section className="tablecard">
            <h2 style={{ padding: '16px 18px 0', margin: 0, fontSize: '16px' }}>📋 Production History</h2>
            <table>
              <thead>
                <tr>
                  <th>Completed Date</th>
                  <th>Product</th>
                  <th>Produced Quantity</th>
                  <th>Ingredients Used</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {completedBatches.length ? (
                  completedBatches.map(b => (
                    <tr key={b.id}>
                      <td>{fmt(b.completed_at || b.started_at)}</td>
                      <td><b>{b.recipe_name}</b></td>
                      <td>
                        <b style={{ color: '#15803d' }}>+{b.produced_quantity || 0} Pieces</b>
                      </td>
                      <td>
                        <span style={{ fontSize: '12px', color: '#64748b' }}>
                          {(b.ingredients || []).map(i => `${i.quantity} ${i.unit || ''} ${i.name}`).join(', ') || '—'}
                        </span>
                      </td>
                      <td>
                        <span className={b.status === 'Completed' ? 'statusCompleted' : 'statusCancelled'}>
                          {b.status === 'Completed' ? '✓ Added to Packed Items' : 'Cancelled'}
                        </span>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr><td colSpan={5}><Empty>No completed production batches yet.</Empty></td></tr>
                )}
              </tbody>
            </table>
          </section>
        </Layout>
      )
    },
    'Product Purchase': () => (
      <Layout title="Product Purchase">
        <Form title={`Record product purchase → Stores in ${purchaseDest === 'packed' ? 'Packed Goods (Billing)' : 'Ingredients'}`} onSubmit={addPurchase}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <label style={{ fontSize: '11px', fontWeight: 700, color: '#475569' }}>
              Add to Stock Location:
            </label>
            <select
              name="destination"
              value={purchaseDest}
              onChange={e => setPurchaseDest(e.target.value)}
              style={{
                padding: '8px 12px',
                fontWeight: 700,
                color: purchaseDest === 'packed' ? '#1d4ed8' : '#15803d',
                background: purchaseDest === 'packed' ? '#eff6ff' : '#f0fdf4',
                border: purchaseDest === 'packed' ? '1px solid #93c5fd' : '1px solid #86efac'
              }}
            >
              <option value="ingredients">🥕 Ingredients (Raw materials for recipes)</option>
              <option value="packed">📦 Packed Goods (Finished goods for direct sale / billing)</option>
            </select>
          </div>
          <input
            name="name"
            list="purchase-suggestions"
            placeholder={purchaseDest === 'packed' ? 'Packed good name (e.g. Juice, Chips, Bread)' : 'Purchased ingredient name (e.g. Flour, Sugar)'}
            required
          />
          <datalist id="purchase-suggestions">
            {purchaseDest === 'packed'
              ? data.products.map(p => <option key={p.id} value={p.name} />)
              : data.ingredients.map(ing => <option key={ing.id} value={ing.name} />)
            }
          </datalist>
          <input name="quantity" type="number" min="0.001" step="any" placeholder="Quantity" required />
          <select name="unit">
            <option>Piece</option>
            <option>Kg</option>
            <option>Gram</option>
            <option>Litre</option>
            <option>Box</option>
            <option>Pack</option>
          </select>
          <input name="cost" type="number" min="0" step="any" placeholder="Total cost ₹" required />
        </Form>
        <section className="tablecard">
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Product / Item</th>
                <th>Stock Location</th>
                <th>Quantity</th>
                <th>Cost</th>
                <th style={{ width: '180px' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {data.purchases.length ? (
                data.purchases.map(pu => {
                  const isEditing = editPurchase?.id === pu.id
                  return (
                    <tr key={pu.id}>
                      <td>{fmt(pu.purchased_at || pu.date)}</td>
                      <td>
                        {isEditing ? (
                          <input
                            value={editPurchase.product_name}
                            onChange={e => setEditPurchase({ ...editPurchase, product_name: e.target.value })}
                            placeholder="Product name"
                            required
                          />
                        ) : (
                          pu.product_name || pu.name || '—'
                        )}
                      </td>
                      <td>
                        {isEditing ? (
                          <select
                            value={editPurchase.destination || 'ingredients'}
                            onChange={e => setEditPurchase({ ...editPurchase, destination: e.target.value })}
                            style={{ fontSize: '12px', padding: '4px 8px' }}
                          >
                            <option value="ingredients">🥕 Ingredients</option>
                            <option value="packed">📦 Packed Goods</option>
                          </select>
                        ) : (
                          pu.destination === 'packed' ? (
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '3px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 700, background: '#eff6ff', color: '#1d4ed8', border: '1px solid #bfdbfe' }}>
                              📦 Packed Good
                            </span>
                          ) : (
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '3px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 700, background: '#f0fdf4', color: '#15803d', border: '1px solid #bbf7d0' }}>
                              🥕 Ingredient
                            </span>
                          )
                        )}
                      </td>
                      <td>
                        {isEditing ? (
                          <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                            <input
                              type="number"
                              min="0.001"
                              step="any"
                              value={editPurchase.quantity}
                              onChange={e => setEditPurchase({ ...editPurchase, quantity: e.target.value })}
                              style={{ width: '80px' }}
                              required
                            />
                            <select
                              value={editPurchase.unit}
                              onChange={e => setEditPurchase({ ...editPurchase, unit: e.target.value })}
                            >
                              <option>Piece</option>
                              <option>Kg</option>
                              <option>Gram</option>
                              <option>Litre</option>
                              <option>Box</option>
                              <option>Pack</option>
                            </select>
                          </div>
                        ) : (
                          `${pu.quantity || 1} ${pu.unit || 'Piece'}`
                        )}
                      </td>
                      <td>
                        {isEditing ? (
                          <input
                            type="number"
                            min="0"
                            step="any"
                            value={editPurchase.cost}
                            onChange={e => setEditPurchase({ ...editPurchase, cost: e.target.value })}
                            style={{ width: '110px' }}
                            required
                          />
                        ) : (
                          money(pu.total_cost ?? pu.cost ?? 0)
                        )}
                      </td>
                      <td>
                        {isEditing ? (
                          <>
                            <button className="btnSave" onClick={() => savePurchaseEdit(pu.id)}>Save</button>
                            <button className="btnCancel" onClick={() => setEditPurchase(null)}>Cancel</button>
                          </>
                        ) : (
                          <>
                            <button
                              className="btnEdit"
                              onClick={() => setEditPurchase({
                                id: pu.id,
                                product_name: pu.product_name || pu.name || '',
                                quantity: pu.quantity || 1,
                                unit: pu.unit || 'Piece',
                                cost: pu.total_cost ?? pu.cost ?? 0,
                                destination: pu.destination || 'ingredients'
                              })}
                            >
                              Edit
                            </button>
                            <button className="btnDelete" onClick={() => deletePurchase(pu.id)}>Delete</button>
                          </>
                        )}
                      </td>
                    </tr>
                  )
                })
              ) : (
                <tr><td colSpan={6}><Empty>No purchase records yet.</Empty></td></tr>
              )}
            </tbody>
          </table>
        </section>
      </Layout>
    ),
    Expenses: () => (
      <Layout title="Expenses">
        <Form title="Add expense" onSubmit={addExpense}>
          <input name="description" placeholder="Expense description" required />
          <input name="amount" type="number" min="0" step="any" placeholder="Amount ₹" required />
        </Form>
        <section className="tablecard">
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Expense</th>
                <th>Amount</th>
                <th style={{ width: '180px' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {data.expenses.length ? (
                data.expenses.map(ex => {
                  const isEditing = editExpense?.id === ex.id
                  return (
                    <tr key={ex.id}>
                      <td>{fmt(ex.expense_at || ex.date)}</td>
                      <td>
                        {isEditing ? (
                          <input
                            value={editExpense.description}
                            onChange={e => setEditExpense({ ...editExpense, description: e.target.value })}
                            placeholder="Expense description"
                            required
                          />
                        ) : (
                          ex.description || '—'
                        )}
                      </td>
                      <td>
                        {isEditing ? (
                          <input
                            type="number"
                            min="0"
                            step="any"
                            value={editExpense.amount}
                            onChange={e => setEditExpense({ ...editExpense, amount: e.target.value })}
                            style={{ width: '110px' }}
                            required
                          />
                        ) : (
                          money(ex.amount)
                        )}
                      </td>
                      <td>
                        {isEditing ? (
                          <>
                            <button className="btnSave" onClick={() => saveExpenseEdit(ex.id)}>Save</button>
                            <button className="btnCancel" onClick={() => setEditExpense(null)}>Cancel</button>
                          </>
                        ) : (
                          <>
                            <button
                              className="btnEdit"
                              onClick={() => setEditExpense({
                                id: ex.id,
                                description: ex.description || '',
                                amount: ex.amount || 0
                              })}
                            >
                              Edit
                            </button>
                            <button className="btnDelete" onClick={() => deleteExpense(ex.id)}>Delete</button>
                          </>
                        )}
                      </td>
                    </tr>
                  )
                })
              ) : (
                <tr><td colSpan={4}><Empty>No expenses recorded yet.</Empty></td></tr>
              )}
            </tbody>
          </table>
        </section>
      </Layout>
    ),
    Employees: () => (
      <Layout title="Employees">
        <Form title="Add Employee" onSubmit={addEmployee}>
          <input name="name" placeholder="Employee full name" required />
          <input name="job" placeholder="Job title / role (e.g. Baker, Chef, Cashier)" required />
          <input name="phone" placeholder="Contact number" type="tel" required />
        </Form>
        <section className="tablecard">
          <table>
            <thead>
              <tr>
                <th>Employee Name</th>
                <th>Job Title / Role</th>
                <th>Contact Number</th>
                <th style={{ width: '180px' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {data.employees.length ? (
                data.employees.map(emp => {
                  const isEditing = editEmployee?.id === emp.id
                  return (
                    <tr key={emp.id}>
                      <td>
                        {isEditing ? (
                          <input
                            value={editEmployee.name}
                            onChange={e => setEditEmployee({ ...editEmployee, name: e.target.value })}
                            placeholder="Employee name"
                            required
                          />
                        ) : (
                          <b>{emp.name}</b>
                        )}
                      </td>
                      <td>
                        {isEditing ? (
                          <input
                            value={editEmployee.job}
                            onChange={e => setEditEmployee({ ...editEmployee, job: e.target.value })}
                            placeholder="Job role"
                            required
                          />
                        ) : (
                          <span className="jobBadge">{emp.job || 'Staff'}</span>
                        )}
                      </td>
                      <td>
                        {isEditing ? (
                          <input
                            value={editEmployee.phone}
                            onChange={e => setEditEmployee({ ...editEmployee, phone: e.target.value })}
                            placeholder="Phone number"
                            required
                          />
                        ) : (
                          <span className="phoneLink">{emp.phone || '—'}</span>
                        )}
                      </td>
                      <td>
                        {isEditing ? (
                          <>
                            <button className="btnSave" onClick={() => saveEmployeeEdit(emp.id)}>Save</button>
                            <button className="btnCancel" onClick={() => setEditEmployee(null)}>Cancel</button>
                          </>
                        ) : (
                          <>
                            <button
                              className="btnEdit"
                              onClick={() => setEditEmployee({ id: emp.id, name: emp.name, job: emp.job, phone: emp.phone })}
                            >
                              Edit
                            </button>
                            <button className="btnDelete" onClick={() => deleteEmployee(emp.id)}>Delete</button>
                          </>
                        )}
                      </td>
                    </tr>
                  )
                })
              ) : (
                <tr><td colSpan={4}><Empty>No employees registered yet. Add team members above.</Empty></td></tr>
              )}
            </tbody>
          </table>
        </section>
      </Layout>
    ),
    Attendance: () => {
      const today = new Date().toISOString().split('T')[0]
      const fullCount = data.attendance.filter(a => a.date === today && a.status === 'Full day').length
      const halfCount = data.attendance.filter(a => a.date === today && a.status === 'Half day').length
      const leaveCount = data.attendance.filter(a => a.date === today && a.status === 'Leave').length

      return (
        <Layout title="Attendance">
          <div className="metrics" style={{ gridTemplateColumns: 'repeat(4, 1fr)', marginBottom: '18px' }}>
            <div className="metric">
              <small>TOTAL EMPLOYEES</small>
              <strong>{data.employees.length}</strong>
              <span>registered staff</span>
            </div>
            <div className="metric">
              <small>FULL DAY (TODAY)</small>
              <strong style={{ color: '#16a34a' }}>{fullCount}</strong>
              <span style={{ color: '#16a34a' }}>present full shift</span>
            </div>
            <div className="metric">
              <small>HALF DAY (TODAY)</small>
              <strong style={{ color: '#d97706' }}>{halfCount}</strong>
              <span style={{ color: '#d97706' }}>partial shift</span>
            </div>
            <div className="metric">
              <small>ON LEAVE (TODAY)</small>
              <strong style={{ color: '#dc2626' }}>{leaveCount}</strong>
              <span style={{ color: '#dc2626' }}>absent / on leave</span>
            </div>
          </div>

          <Form title="Mark Employee Attendance" onSubmit={addAttendance}>
            <select name="employee_id" required defaultValue="">
              <option value="" disabled>-- Select Employee --</option>
              {data.employees.map(emp => (
                <option key={emp.id} value={emp.id}>
                  {emp.name} ({emp.job || 'Staff'})
                </option>
              ))}
            </select>
            <input
              name="date"
              type="date"
              defaultValue={today}
              required
              title="Attendance date (auto-fetched to today)"
            />
            <select name="status" defaultValue="Full day" required>
              <option value="Full day">Full day</option>
              <option value="Half day">Half day</option>
              <option value="Leave">Leave</option>
            </select>
          </Form>

          <section className="tablecard">
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Employee</th>
                  <th>Attendance Status</th>
                  <th style={{ width: '180px' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {data.attendance.length ? (
                  data.attendance.map(att => {
                    const isEditing = editAttendance?.id === att.id
                    const statusClass = att.status === 'Full day'
                      ? 'statusFullDay'
                      : (att.status === 'Half day' ? 'statusHalfDay' : 'statusLeave')

                    return (
                      <tr key={att.id}>
                        <td>
                          {isEditing ? (
                            <input
                              type="date"
                              value={editAttendance.date}
                              onChange={e => setEditAttendance({ ...editAttendance, date: e.target.value })}
                              required
                            />
                          ) : (
                            fmt(att.date)
                          )}
                        </td>
                        <td>
                          {isEditing ? (
                            <select
                              value={editAttendance.employee_id}
                              onChange={e => {
                                const found = data.employees.find(emp => String(emp.id) === String(e.target.value))
                                setEditAttendance({
                                  ...editAttendance,
                                  employee_id: e.target.value,
                                  employee_name: found ? found.name : editAttendance.employee_name
                                })
                              }}
                            >
                              {data.employees.map(emp => (
                                <option key={emp.id} value={emp.id}>{emp.name}</option>
                              ))}
                            </select>
                          ) : (
                            <b>{att.employee_name || 'Staff'}</b>
                          )}
                        </td>
                        <td>
                          {isEditing ? (
                            <select
                              value={editAttendance.status}
                              onChange={e => setEditAttendance({ ...editAttendance, status: e.target.value })}
                            >
                              <option value="Full day">Full day</option>
                              <option value="Half day">Half day</option>
                              <option value="Leave">Leave</option>
                            </select>
                          ) : (
                            <span className={statusClass}>
                              {att.status === 'Full day' ? '● Full day' : (att.status === 'Half day' ? '◑ Half day' : '○ Leave')}
                            </span>
                          )}
                        </td>
                        <td>
                          {isEditing ? (
                            <>
                              <button className="btnSave" onClick={() => saveAttendanceEdit(att.id)}>Save</button>
                              <button className="btnCancel" onClick={() => setEditAttendance(null)}>Cancel</button>
                            </>
                          ) : (
                            <>
                              <button
                                className="btnEdit"
                                onClick={() => setEditAttendance({
                                  id: att.id,
                                  employee_id: att.employee_id,
                                  employee_name: att.employee_name,
                                  date: att.date,
                                  status: att.status
                                })}
                              >
                                Edit
                              </button>
                              <button className="btnDelete" onClick={() => deleteAttendance(att.id)}>Delete</button>
                            </>
                          )}
                        </td>
                      </tr>
                    )
                  })
                ) : (
                  <tr><td colSpan={4}><Empty>No attendance records yet. Mark staff attendance above.</Empty></td></tr>
                )}
              </tbody>
            </table>
          </section>
        </Layout>
      )
    },
    'Sales & Customers': () => {
      return (
        <Layout title="Sales & Customers">
          <section className="tablecard">
            <table>
              <thead>
                <tr>
                  <th>Bill</th>
                  <th>Date</th>
                  <th>Customer</th>
                  <th>Items</th>
                  <th>Payment</th>
                  <th>Total</th>
                  <th style={{ width: '160px' }}>Invoice</th>
                </tr>
              </thead>
              <tbody>
                {data.sales.length ? (
                  data.sales.map(x => {
                    const saleItems = data.items
                      .filter(i => String(i.sale_id) === String(x.id))
                      .map(i => ({
                        name: i.product_name,
                        quantity: Number(i.quantity) || 1,
                        price: Number(i.unit_price) || 0,
                        total: (Number(i.quantity) || 1) * (Number(i.unit_price) || 0)
                      }))
                    const invObj = {
                      id: x.id,
                      customer_name: x.customer_name,
                      customer_phone: x.customer_phone,
                      payment_method: x.payment_method,
                      subtotal: x.subtotal || x.total,
                      total: x.total,
                      sold_at: x.sold_at,
                      items: saleItems
                    }
                    const totalQty = saleItems.reduce((a, i) => a + i.quantity, 0)
                    return (
                      <tr key={x.id}>
                        <td><b>#{x.id}</b></td>
                        <td>{fmt(x.sold_at)}</td>
                        <td>{x.customer_name || 'Walk-in'}</td>
                        <td>{totalQty}</td>
                        <td>{x.payment_method || 'Cash'}</td>
                        <td><b>{money(x.total)}</b></td>
                        <td>
                          <div style={{ display: 'flex', gap: '6px' }}>
                            <button
                              className="btnPrint"
                              onClick={() => printBill(invObj, { name: business.name })}
                              title="Print thermal bill"
                            >
                              🖨️ Print
                            </button>
                            <button
                              className="btnPdf"
                              onClick={async () => {
                                const saved = await saveBillPdf(invObj, { name: business.name })
                                if (saved && saved !== 'printed') setNote(`Bill PDF saved: ${saved}`)
                              }}
                              title="Download PDF"
                            >
                              📄 PDF
                            </button>
                          </div>
                        </td>
                      </tr>
                    )
                  })
                ) : (
                  <tr><td colSpan={7}><Empty>No bills yet.</Empty></td></tr>
                )}
              </tbody>
            </table>
          </section>
        </Layout>
      )
    },
    'Change Password': () => (
      <Layout title="Change Password">
        <section className="formcard">
          <h2>Set a new password</h2>
          <form className="formgrid" onSubmit={change}>
            <input
              type="password"
              minLength="6"
              value={pass}
              onChange={e => setPass(e.target.value)}
              placeholder="New password"
              required
            />
            <button>Update password</button>
          </form>
          {note && <p className="note" style={{ marginTop: '10px' }}>{note}</p>}
        </section>
      </Layout>
    )
  }

  let Page = pages[view]
  return (
    <div className="shell">
      <aside>
        <div className="brand">
          <img src={logoImg} alt="Crumb ERP Logo" className="brandLogo" />
          <b>{business.name}</b>
        </div>
        {Object.keys(pages).map(x => (
          <button key={x} className={view === x ? 'active' : ''} onClick={() => setView(x)}>
            {x}
          </button>
        ))}
        <div className="sidebarBottom">
          <button onClick={doBackup}>Backup data</button>
          <button className="logout" onClick={() => supabase.auth.signOut()}>Sign out</button>
        </div>
      </aside>
      <main>
        <Page />
        {receiptModal && (
          <div className="receiptModal" onClick={() => setReceiptModal(null)}>
            <div className="receiptBox" onClick={e => e.stopPropagation()}>
              <h2><span>🧾</span> Bill #{receiptModal.id} Completed</h2>
              <p style={{ color: '#718097', margin: '4px 0 12px' }}>
                {business.name} · {fmt(receiptModal.sold_at)}
              </p>

              <div className="receiptSummaryCard">
                <div className="receiptSummaryRow">
                  <span>Customer:</span>
                  <b>{receiptModal.customer_name || 'Walk-in'}</b>
                </div>
                {receiptModal.customer_phone && (
                  <div className="receiptSummaryRow">
                    <span>Phone:</span>
                    <span>{receiptModal.customer_phone}</span>
                  </div>
                )}
                <div className="receiptSummaryRow">
                  <span>Payment:</span>
                  <b>{receiptModal.payment_method}</b>
                </div>
                <div style={{ borderTop: '1px dashed #cfd7e6', margin: '8px 0' }} />
                {receiptModal.items.map((it, idx) => (
                  <div className="receiptSummaryRow" key={idx}>
                    <span>{it.quantity}x {it.name}</span>
                    <span>{money(it.total)}</span>
                  </div>
                ))}
                <div className="receiptSummaryTotal">
                  <span>Net Amount</span>
                  <span>{money(receiptModal.total)}</span>
                </div>
              </div>

              <div className="receiptActions">
                <button
                  className="printBtn"
                  onClick={() => printBill(receiptModal, { name: business.name })}
                >
                  🖨️ Print Bill
                </button>
                <button
                  className="pdfBtn"
                  onClick={async () => {
                    const saved = await saveBillPdf(receiptModal, { name: business.name })
                    if (saved && saved !== 'printed') setNote(`Bill PDF saved: ${saved}`)
                  }}
                >
                  📄 Save PDF
                </button>
                <button
                  className="newBillBtn"
                  onClick={() => setReceiptModal(null)}
                >
                  ➕ Next Bill
                </button>
              </div>
            </div>
          </div>
        )}
        {prodModal && (
          <div className="receiptModal" onClick={() => setProdModal(null)}>
            <div className="receiptBox" onClick={e => e.stopPropagation()}>
              <h2><span>🥐</span> Batch Ready: {prodModal.batch.recipe_name}</h2>
              <p style={{ color: '#718097', margin: '4px 0 16px', fontSize: '13px' }}>
                Cooking / baking is finished! Specify how many finished units were produced to add to <b>Packed Items</b> for <b>Billing / POS</b>.
              </p>

              <div style={{ display: 'grid', gap: '12px', marginBottom: '18px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#475569', marginBottom: '4px' }}>
                    How many finished quantity were produced? *
                  </label>
                  <input
                    type="number"
                    min="1"
                    step="1"
                    value={prodModal.quantity}
                    onChange={e => setProdModal({ ...prodModal, quantity: e.target.value })}
                    placeholder="e.g. 24"
                    autoFocus
                    required
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#475569', marginBottom: '4px' }}>
                    Selling price ₹ (per unit):
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={prodModal.price}
                    onChange={e => setProdModal({ ...prodModal, price: e.target.value })}
                    placeholder="e.g. 120"
                    required
                  />
                </div>
              </div>

              <div className="receiptActions">
                <button
                  className="printBtn"
                  style={{ background: '#16a34a' }}
                  onClick={handleCompleteBatch}
                >
                  ✓ Confirm & Add to Packed Items
                </button>
                <button
                  className="newBillBtn"
                  onClick={() => setProdModal(null)}
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  )
}

function Portal() {
  const [s, setS] = useState(null)
  const [m, setM] = useState()
  const [loading, setLoading] = useState(true)
  const [msg, setMsg] = useState('')

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setS(data?.session || null))
    let { data: { subscription } } = supabase.auth.onAuthStateChange((_e, n) => setS(n))
    return () => subscription.unsubscribe()
  }, [])

  useEffect(() => {
    async function route() {
      if (!s) {
        setLoading(false)
        return
      }
      setLoading(true)
      try {
        let a = await supabase.rpc('is_platform_administrator')
        if (a.data) {
          setM({ platform: true })
          setLoading(false)
          return
        }

        let r = await supabase.from('business_members').select('business_id').eq('user_id', s.user.id).limit(1).maybeSingle()
        if (r.error) {
          setMsg(`Failed to check workspace membership: ${r.error.message}`)
          setM(null)
          setLoading(false)
          return
        }

        if (!r.data) {
          setMsg(`Your account (${s.user.email}) is not assigned to any workspace in Supabase.`)
          setM(null)
          setLoading(false)
          return
        }

        let b = await supabase.from('businesses').select('id,name,access_ends_at').eq('id', r.data.business_id).maybeSingle()
        if (b.error) {
          setMsg(`Failed to load workspace data: ${b.error.message}`)
          setM(null)
        } else if (!b.data) {
          setMsg('Workspace record was not found or access was restricted by database security rules.')
          setM(null)
        } else if (b.data.access_ends_at && new Date(b.data.access_ends_at) <= new Date()) {
          setMsg(`Workspace "${b.data.name}" access ended on ${fmt(b.data.access_ends_at)}. Please contact your administrator.`)
          setM(null)
        } else {
          setM({ business: b.data })
        }
      } catch (err) {
        setMsg(`Access check error: ${err.message}`)
        setM(null)
      } finally {
        setLoading(false)
      }
    }
    route()

    if (!supabase) return
    const channel = supabase
      .channel('portal-business-access-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'businesses' }, () => {
        route()
      })
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [s])

  if (!configured) return <div className="loader">Supabase configuration missing in .env</div>
  if (loading) return <div className="loader">Checking access…</div>
  if (!s) return <Login />
  if (m?.platform) return <Admin />
  if (m?.business) return <Restaurant business={m.business} />
  return (
    <main className="auth">
      <div className="authbox">
        <h1>Access unavailable</h1>
        <p>{msg}</p>
        <button onClick={() => supabase.auth.signOut()}>Sign out</button>
      </div>
    </main>
  )
}

createRoot(document.getElementById('root')).render(<Portal />)

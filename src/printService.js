/**
 * Retail Bill Printing and PDF Generation Service
 * Modeled after Retail ERP thermal bill printing and invoice export.
 */

export function generateInvoiceHtml(inv, shopConfig = {}) {
  const shopName = shopConfig.name || 'Crumb & Co.'
  const items = inv.items || []
  const totalQty = items.reduce((s, i) => s + (Number(i.quantity ?? i.qty) || 0), 0)
  const totalItems = items.length
  const totalAmt = Number(inv.total != null ? inv.total : inv.subtotal || 0)

  const dateObj = inv.sold_at || inv.date ? new Date(inv.sold_at || inv.date) : new Date()
  const validDate = !isNaN(dateObj.getTime()) ? dateObj : new Date()

  const dateStr = validDate.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  })

  const timeStr = validDate.toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true
  })

  const customerName = inv.customer_name || inv.customer || 'Walk-in'
  const customerPhone = inv.customer_phone || inv.phone || ''
  const paymentMethod = inv.payment_method || 'Cash'

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8"/>
  <title>Bill #${inv.id || 'Receipt'}</title>
  <style>
    * { margin:0; padding:0; box-sizing:border-box }
    html, body { margin:0; padding:0; background:#fff }
    body {
      font-family: 'Courier New', Courier, monospace;
      font-size: 11px;
      line-height: 1.3;
      color: #000;
      width: 80mm;
      padding: 3mm 4mm 4mm 4mm;
      margin: 0 auto;
    }
    .center { text-align: center }
    .right { text-align: right }
    .bold { font-weight: bold }
    .lg { font-size: 15px; font-weight: bold }
    .md { font-size: 12px; font-weight: bold }
    .sm { font-size: 10px }
    .xs { font-size: 9px }
    .line { border-top: 1px dashed #000; margin: 5px 0 }
    .dline { border-top: 2px solid #000; margin: 5px 0 }
    .row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 4px;
      padding: 2px 0;
    }
    .row span:first-child { flex: 1 1 auto; min-width: 0 }
    .row span:last-child { flex: 0 0 auto; text-align: right; max-width: 44mm; word-break: break-word }
    table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 4px;
      table-layout: fixed;
    }
    th, td {
      border: 1px solid #000;
      padding: 3px 2px;
      font-size: 10px;
      line-height: 1.2;
      vertical-align: top;
      word-break: break-word;
    }
    th {
      background: #f5f5f5;
      font-weight: bold;
    }
    .grand {
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 15px;
      font-weight: bold;
      padding: 4px 0;
    }
    @media print {
      body { width: 80mm; margin: 0; padding: 2mm 3mm }
      @page { margin: 0; size: 80mm auto }
    }
  </style>
</head>
<body>
  <div class="center">
    <div class="lg">${shopName}</div>
    <div class="sm" style="margin-top: 2px;">Fresh Bakes & Artisanal Café</div>
    <div class="xs" style="color: #444; margin-top: 2px;">TAX INVOICE / CASH BILL</div>
  </div>

  <div class="dline"></div>

  <div class="row">
    <span>Customer Name:</span>
    <span class="bold">${customerName}</span>
  </div>
  ${customerPhone ? `<div class="row sm"><span>Phone:</span><span>${customerPhone}</span></div>` : ''}

  <div class="line"></div>

  <div class="row sm">
    <span>Bill No:</span>
    <span class="bold">#${inv.id}</span>
  </div>
  <div class="row sm">
    <span>Date:</span>
    <span>${dateStr}</span>
  </div>
  <div class="row sm">
    <span>Time:</span>
    <span>${timeStr}</span>
  </div>

  <div class="dline"></div>

  <table>
    <colgroup>
      <col style="width: 12%">
      <col style="width: 46%">
      <col style="width: 14%">
      <col style="width: 28%">
    </colgroup>
    <thead>
      <tr>
        <th style="text-align: center;">S.No</th>
        <th>Product</th>
        <th style="text-align: center;">Qty</th>
        <th style="text-align: right;">Amount</th>
      </tr>
    </thead>
    <tbody>
      ${items.map((it, idx) => {
        const qty = Number(it.quantity ?? it.qty) || 1
        const price = Number(it.price ?? it.unit_price) || 0
        const total = Number(it.total != null ? it.total : qty * price)
        return `<tr>
          <td style="text-align: center;">${idx + 1}</td>
          <td>${it.name || it.product_name || 'Item'}</td>
          <td style="text-align: center;">${qty}</td>
          <td style="text-align: right;">${total.toFixed(2)}</td>
        </tr>`
      }).join('')}
    </tbody>
  </table>

  <div class="line"></div>

  <div class="row sm bold">
    <span>Total Items: ${totalItems}</span>
    <span>Total Qty: ${totalQty}</span>
  </div>

  <div class="row sm">
    <span>Sub Total:</span>
    <span>₹${totalAmt.toFixed(2)}</span>
  </div>

  <div class="dline"></div>

  <div class="grand">
    <span>NET AMOUNT</span>
    <span>₹${totalAmt.toFixed(2)}</span>
  </div>

  <div class="dline"></div>

  <div class="row sm">
    <span>Payment Mode:</span>
    <span class="bold">${paymentMethod}</span>
  </div>

  <div class="line"></div>

  <div class="center xs" style="margin-top: 8px;">
    <b>GOODS ONCE SOLD CANNOT BE RETURNED</b>
  </div>
  <div class="center xs" style="margin-top: 4px;">
    THANK YOU · VISIT AGAIN!
  </div>
  <div class="center xs" style="margin-top: 4px; font-weight: bold;">
    For ${shopName}
  </div>
</body>
</html>`
}

export async function printBill(inv, shopConfig = {}) {
  const html = generateInvoiceHtml(inv, shopConfig)

  if (window.crumbDesktop && typeof window.crumbDesktop.printInvoice === 'function') {
    return await window.crumbDesktop.printInvoice(html)
  }

  // Fallback for browser preview
  const win = window.open('', '_blank', 'width=450,height=750')
  if (!win) {
    alert('Print window was blocked by the browser. Please allow popups.')
    return false
  }
  win.document.open()
  win.document.write(html)
  win.document.close()
  setTimeout(() => {
    win.focus()
    win.print()
  }, 350)
  return true
}

export async function saveBillPdf(inv, shopConfig = {}) {
  const html = generateInvoiceHtml(inv, shopConfig)
  const defaultName = `Bill-${inv.id || Date.now()}-${(inv.customer_name || 'Customer').replace(/[^a-zA-Z0-9_-]/g, '_')}.pdf`

  if (window.crumbDesktop && typeof window.crumbDesktop.saveInvoicePdf === 'function') {
    const savedPath = await window.crumbDesktop.saveInvoicePdf({ html, defaultName })
    return savedPath
  }

  // Fallback for browser: triggers print dialog where user can save as PDF
  const win = window.open('', '_blank', 'width=450,height=750')
  if (!win) {
    alert('PDF export window was blocked by the browser. Please allow popups.')
    return null
  }
  win.document.open()
  win.document.write(html)
  win.document.close()
  setTimeout(() => {
    win.focus()
    win.print()
  }, 350)
  return 'printed'
}

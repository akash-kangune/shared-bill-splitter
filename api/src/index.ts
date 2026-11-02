import { Hono } from 'hono'

const app = new Hono<{ Bindings: Env }>()

// Health check
app.get('/api/health', (c) => c.json({ status: 'ok' }))

// Create a home
app.post('/api/homes', async (c) => {
  const body = await c.req.json<{ name?: unknown }>()

  if (typeof body.name !== 'string' || !body.name.trim()) {
    return c.json({ error: 'Home name is required' }, 400)
  }

  const id = crypto.randomUUID()
  const name = body.name.trim()

  await c.env.DB.prepare('INSERT INTO homes (id, name) VALUES (?, ?)').bind(id, name).run()

  return c.json({ id, name }, 201)
})

// Add a member to a home
app.post('/api/homes/:homeId/members', async (c) => {
  const homeId = c.req.param('homeId')
  const body = await c.req.json<{ name?: unknown }>()

  if (typeof body.name !== 'string' || !body.name.trim()) {
    return c.json({ error: 'Member name is required' }, 400)
  }

  const home = await c.env.DB.prepare('SELECT id FROM homes WHERE id = ?').bind(homeId).first()

  if (!home) {
    return c.json({ error: 'Home not found' }, 404)
  }

  const id = crypto.randomUUID()
  const name = body.name.trim()

  await c.env.DB.prepare('INSERT INTO members (id, home_id, name) VALUES (?, ?, ?)')
    .bind(id, homeId, name)
    .run()

  return c.json({ id, homeId, name }, 201)
})

// Create a bill and split it equally between home members
app.post('/api/homes/:homeId/bills', async (c) => {
  const homeId = c.req.param('homeId')
  const body = await c.req.json<{
    title?: unknown
    totalCents?: unknown
  }>()

  // Check whether the home exists
  const home = await c.env.DB.prepare('SELECT id FROM homes WHERE id = ?').bind(homeId).first()

  if (!home) {
    return c.json({ error: 'Home not found' }, 404)
  }

  // Validate bill details
  if (
    typeof body.title !== 'string' ||
    !body.title.trim() ||
    typeof body.totalCents !== 'number' ||
    !Number.isInteger(body.totalCents) ||
    body.totalCents <= 0
  ) {
    return c.json({ error: 'Invalid bill title or total amount' }, 422)
  }

  const title = body.title.trim()
  const totalCents = body.totalCents

  // Get members in the order they were added
  const members = await c.env.DB.prepare(
    'SELECT id FROM members WHERE home_id = ? ORDER BY rowid ASC',
  )
    .bind(homeId)
    .all<{ id: string }>()

  if (members.results.length === 0) {
    return c.json({ error: 'A home must have members to create a bill' }, 422)
  }

  const billId = crypto.randomUUID()
  const memberCount = members.results.length

  // Calculate each member's share
  const baseAmount = Math.floor(totalCents / memberCount)
  const remainder = totalCents % memberCount

  const shares = members.results.map((member, index) => ({
    id: crypto.randomUUID(),
    memberId: member.id,
    amountCents: baseAmount + (index < remainder ? 1 : 0),
    paidAt: null,
  }))

  // Save the bill and all shares together
  const statements = [
    c.env.DB.prepare(
      'INSERT INTO bills (id, home_id, title, total_cents) VALUES (?, ?, ?, ?)',
    ).bind(billId, homeId, title, totalCents),
    ...shares.map((share) =>
      c.env.DB.prepare(
        'INSERT INTO shares (id, bill_id, member_id, amount_cents, paid_at) VALUES (?, ?, ?, ?, NULL)',
      ).bind(share.id, billId, share.memberId, share.amountCents),
    ),
  ]

  await c.env.DB.batch(statements)

  return c.json(
    {
      id: billId,
      homeId,
      title,
      totalCents,
      shares,
    },
    201,
  )
})

// Get all dashboard data for a home
app.get('/api/homes/:homeId', async (c) => {
  const homeId = c.req.param('homeId')

  const home = await c.env.DB.prepare('SELECT id, name FROM homes WHERE id = ?')
    .bind(homeId)
    .first<{ id: string; name: string }>()

  if (!home) {
    return c.json({ error: 'Home not found' }, 404)
  }

  const members = await c.env.DB.prepare(
    `SELECT id, home_id AS homeId, name
     FROM members
     WHERE home_id = ?
     ORDER BY rowid ASC`,
  )
    .bind(homeId)
    .all<{
      id: string
      homeId: string
      name: string
    }>()

  const bills = await c.env.DB.prepare(
    `SELECT id, home_id AS homeId, title, total_cents AS totalCents
     FROM bills
     WHERE home_id = ?
     ORDER BY rowid DESC`,
  )
    .bind(homeId)
    .all<{
      id: string
      homeId: string
      title: string
      totalCents: number
    }>()

  const shares = await c.env.DB.prepare(
    `SELECT
       s.id,
       s.bill_id AS billId,
       s.member_id AS memberId,
       s.amount_cents AS amountCents,
       s.paid_at AS paidAt
     FROM shares s
     JOIN bills b ON b.id = s.bill_id
     WHERE b.home_id = ?
     ORDER BY s.rowid ASC`,
  )
    .bind(homeId)
    .all<{
      id: string
      billId: string
      memberId: string
      amountCents: number
      paidAt: string | null
    }>()

  const dashboardBills = bills.results.map((bill) => ({
    ...bill,
    shares: shares.results
      .filter((share) => share.billId === bill.id)
      .map(({ billId, ...share }) => share),
  }))

  return c.json({
    home,
    members: members.results,
    bills: dashboardBills,
  })
})

export default app

// Pay a share
app.post('/api/bills/:billId/shares/:shareId/pay', async (c) => {
  const billId = c.req.param('billId')
  const shareId = c.req.param('shareId')
  const key = c.req.header('Idempotency-Key')?.trim()

  if (!key) {
    return c.json({ error: 'Idempotency-Key header is required' }, 400)
  }

  const bill = await c.env.DB.prepare('SELECT id FROM bills WHERE id = ?').bind(billId).first()

  if (!bill) {
    return c.json({ error: 'Bill not found' }, 404)
  }

  const share = await c.env.DB.prepare(
    `SELECT id, member_id AS memberId,
            amount_cents AS amountCents,
            paid_at AS paidAt,
            idempotency_key AS idempotencyKey
     FROM shares
     WHERE id = ? AND bill_id = ?`,
  )
    .bind(shareId, billId)
    .first<{
      id: string
      memberId: string
      amountCents: number
      paidAt: string | null
      idempotencyKey: string | null
    }>()

  if (!share) {
    return c.json({ error: 'Share not found' }, 404)
  }

  if (share.paidAt) {
    if (share.idempotencyKey === key) {
      return c.json({
        id: share.id,
        memberId: share.memberId,
        amountCents: share.amountCents,
        paidAt: share.paidAt,
      })
    }

    return c.json({ error: 'Share already paid' }, 409)
  }

  const paidAt = new Date().toISOString()

  const result = await c.env.DB.prepare(
    `UPDATE shares
     SET paid_at = ?, idempotency_key = ?
     WHERE id = ? AND bill_id = ? AND paid_at IS NULL`,
  )
    .bind(paidAt, key, shareId, billId)
    .run()

  if (result.meta.changes === 1) {
    return c.json({
      id: share.id,
      memberId: share.memberId,
      amountCents: share.amountCents,
      paidAt,
    })
  }

  const updated = await c.env.DB.prepare(
    `SELECT paid_at AS paidAt, idempotency_key AS idempotencyKey
     FROM shares WHERE id = ? AND bill_id = ?`,
  )
    .bind(shareId, billId)
    .first<{ paidAt: string | null; idempotencyKey: string | null }>()

  if (updated?.paidAt && updated.idempotencyKey === key) {
    return c.json({
      id: share.id,
      memberId: share.memberId,
      amountCents: share.amountCents,
      paidAt: updated.paidAt,
    })
  }

  return c.json({ error: 'Share already paid' }, 409)
})

// Get member balances
app.get('/api/homes/:homeId/balances', async (c) => {
  const homeId = c.req.param('homeId')

  const home = await c.env.DB.prepare('SELECT id FROM homes WHERE id = ?').bind(homeId).first()

  if (!home) {
    return c.json({ error: 'Home not found' }, 404)
  }

  const result = await c.env.DB.prepare(
    `SELECT
       m.id AS memberId,
       m.name AS name,
       COALESCE(SUM(
         CASE
           WHEN b.id IS NOT NULL AND s.paid_at IS NULL
           THEN s.amount_cents
           ELSE 0
         END
       ), 0) AS outstandingCents
     FROM members m
     LEFT JOIN shares s ON s.member_id = m.id
     LEFT JOIN bills b ON b.id = s.bill_id AND b.home_id = m.home_id
     WHERE m.home_id = ?
     GROUP BY m.id, m.name
     ORDER BY m.rowid ASC`,
  )
    .bind(homeId)
    .all<{
      memberId: string
      name: string
      outstandingCents: number
    }>()

  return c.json({ balances: result.results })
})

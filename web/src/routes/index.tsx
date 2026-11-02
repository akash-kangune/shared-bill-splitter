import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useState } from 'react'

export const Route = createFileRoute('/')({
  component: Home,
})

type Member = {
  id: string
  homeId: string
  name: string
}

type Share = {
  id: string
  memberId: string
  amountCents: number
  paidAt: string | null
}

type Bill = {
  id: string
  homeId: string
  title: string
  totalCents: number
  shares: Share[]
}

type Balance = {
  memberId: string
  name: string
  outstandingCents: number
}

type DashboardResponse = {
  home: {
    id: string
    name: string
  }
  members: Member[]
  bills: Bill[]
}

async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  })

  const data = await response.json()

  if (!response.ok) {
    throw new Error(data.error || 'Something went wrong')
  }

  return data as T
}

function money(cents: number) {
  return `₹${(cents / 100).toFixed(2)}`
}

function Home() {
  const [home, setHome] = useState<{
    id: string
    name: string
  } | null>(null)

  const [members, setMembers] = useState<Member[]>([])
  const [bills, setBills] = useState<Bill[]>([])
  const [balances, setBalances] = useState<Balance[]>([])

  const [homeName, setHomeName] = useState('')
  const [memberName, setMemberName] = useState('')
  const [billTitle, setBillTitle] = useState('')
  const [billAmount, setBillAmount] = useState('')

  const [loading, setLoading] = useState(false)
  const [initializing, setInitializing] = useState(true)
  const [error, setError] = useState('')

  // Load saved home and dashboard data after page refresh
  useEffect(() => {
    async function loadDashboard() {
      const savedHomeId = localStorage.getItem('splitmate-home-id')

      if (!savedHomeId) {
        setInitializing(false)
        return
      }

      try {
        const result = await api<DashboardResponse>(`/api/homes/${savedHomeId}`)

        setHome(result.home)
        setMembers(result.members)
        setBills(result.bills)

        const balanceResult = await api<{
          balances: Balance[]
        }>(`/api/homes/${savedHomeId}/balances`)

        setBalances(balanceResult.balances)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not load saved home')
      } finally {
        setInitializing(false)
      }
    }

    void loadDashboard()
  }, [])

  // Create a new home
  async function createHome(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setLoading(true)
    setError('')

    try {
      const result = await api<{
        id: string
        name: string
      }>('/api/homes', {
        method: 'POST',
        body: JSON.stringify({ name: homeName }),
      })

      setHome(result)
      localStorage.setItem('splitmate-home-id', result.id)
      setHomeName('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create home')
    } finally {
      setLoading(false)
    }
  }

  // Add a member to the home
  async function addMember(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!home) return

    setLoading(true)
    setError('')

    try {
      const result = await api<Member>(`/api/homes/${home.id}/members`, {
        method: 'POST',
        body: JSON.stringify({ name: memberName }),
      })

      setMembers((current) => [...current, result])
      setMemberName('')

      await refreshBalances(home.id)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add member')
    } finally {
      setLoading(false)
    }
  }

  // Create and split a bill
  async function createBill(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!home) return

    setLoading(true)
    setError('')

    try {
      const result = await api<Bill>(`/api/homes/${home.id}/bills`, {
        method: 'POST',
        body: JSON.stringify({
          title: billTitle,
          totalCents: Math.round(Number(billAmount) * 100),
        }),
      })

      setBills((current) => [result, ...current])
      setBillTitle('')
      setBillAmount('')

      await refreshBalances(home.id)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create bill')
    } finally {
      setLoading(false)
    }
  }

  // Refresh member balances from backend
  async function refreshBalances(homeId: string) {
    const result = await api<{
      balances: Balance[]
    }>(`/api/homes/${homeId}/balances`)

    setBalances(result.balances)
  }

  // Pay an individual share
  async function payShare(billId: string, shareId: string) {
    setLoading(true)
    setError('')

    try {
      const result = await api<Share>(`/api/bills/${billId}/shares/${shareId}/pay`, {
        method: 'POST',
        headers: {
          'Idempotency-Key': crypto.randomUUID(),
        },
      })

      setBills((current) =>
        current.map((bill) =>
          bill.id === billId
            ? {
                ...bill,
                shares: bill.shares.map((share) => (share.id === shareId ? result : share)),
              }
            : bill,
        ),
      )

      if (home) {
        await refreshBalances(home.id)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Payment failed')
    } finally {
      setLoading(false)
    }
  }

  if (initializing) {
    return (
      <main className="app">
        <section className="panel">
          <p>Loading your dashboard...</p>
        </section>
      </main>
    )
  }

  return (
    <main className="app">
      <header className="header">
        <div>
          <p className="eyebrow">SHARED EXPENSES</p>
          <h1>
            Split<span>Mate.</span>
          </h1>
          <p className="subtitle">Simple and fair bill splitting.</p>
        </div>
      </header>

      {error && <div className="error">{error}</div>}

      {!home ? (
        <section className="panel welcome">
          <h2>Create your shared home</h2>
          <p>Start by giving your home a name.</p>

          <form onSubmit={createHome}>
            <input
              value={homeName}
              onChange={(event) => setHomeName(event.target.value)}
              placeholder="Example: My Shared Apartment"
              required
            />

            <button type="submit" disabled={loading}>
              {loading ? 'Creating...' : 'Create home'}
            </button>
          </form>
        </section>
      ) : (
        <>
          <section className="welcome panel">
            <p className="eyebrow">YOUR HOME</p>
            <h2>{home.name}</h2>
            <p>{members.length} members added</p>
          </section>

          <div className="dashboard">
            <section className="panel">
              <h2>Add a member</h2>

              <form onSubmit={addMember}>
                <input
                  value={memberName}
                  onChange={(event) => setMemberName(event.target.value)}
                  placeholder="Member name"
                  required
                />

                <button type="submit" disabled={loading}>
                  Add member
                </button>
              </form>

              <h3>Members</h3>

              {members.length === 0 ? (
                <p className="muted">No members yet. Add your first member.</p>
              ) : (
                <ul className="member-list">
                  {members.map((member) => (
                    <li key={member.id}>{member.name}</li>
                  ))}
                </ul>
              )}
            </section>

            <section className="panel">
              <h2>Create a bill</h2>

              <form onSubmit={createBill}>
                <input
                  value={billTitle}
                  onChange={(event) => setBillTitle(event.target.value)}
                  placeholder="Bill title"
                  required
                />

                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={billAmount}
                  onChange={(event) => setBillAmount(event.target.value)}
                  placeholder="Amount in ₹"
                  required
                />

                <button type="submit" disabled={loading || members.length === 0}>
                  Create and split bill
                </button>
              </form>

              {members.length === 0 && <p className="muted">Add members before creating a bill.</p>}
            </section>
          </div>

          <section className="panel">
            <h2>Member balances</h2>

            {balances.length === 0 ? (
              <p className="muted">Balances will appear here after you add members.</p>
            ) : (
              <ul className="balance-list">
                {balances.map((balance) => (
                  <li key={balance.memberId}>
                    <span>{balance.name}</span>
                    <strong>{money(balance.outstandingCents)}</strong>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="panel">
            <h2>Recent bills</h2>

            {bills.length === 0 ? (
              <p className="muted">No bills yet. Create your first bill above.</p>
            ) : (
              bills.map((bill) => (
                <article className="bill" key={bill.id}>
                  <div className="bill-heading">
                    <div>
                      <h3>{bill.title}</h3>
                      <p className="muted">Total: {money(bill.totalCents)}</p>
                    </div>
                  </div>

                  {bill.shares.map((share) => {
                    const member = members.find((item) => item.id === share.memberId)

                    return (
                      <div className="share" key={share.id}>
                        <div>
                          <strong>{member?.name || 'Member'}</strong>

                          <p className="muted">{money(share.amountCents)}</p>
                        </div>

                        {share.paidAt ? (
                          <span className="paid">Paid</span>
                        ) : (
                          <button
                            type="button"
                            className="pay-button"
                            disabled={loading}
                            onClick={() => payShare(bill.id, share.id)}
                          >
                            Pay share
                          </button>
                        )}
                      </div>
                    )
                  })}
                </article>
              ))
            )}
          </section>
        </>
      )}
    </main>
  )
}

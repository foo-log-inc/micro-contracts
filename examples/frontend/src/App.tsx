import { useState, useEffect } from 'react';

// Import generated API clients
import { healthApi, userApi } from './core/api.generated';

// Import types from contract
import type { HealthStatus, Session, User, UserListResponse } from '@project/contract/core/schemas/types';

// CSS styles
const styles = {
  container: {
    maxWidth: '900px',
    margin: '0 auto',
    padding: '40px 20px',
  },
  header: {
    textAlign: 'center' as const,
    marginBottom: '40px',
  },
  title: {
    fontSize: '2.5rem',
    fontWeight: 700,
    background: 'linear-gradient(135deg, #38bdf8, #818cf8)',
    WebkitBackgroundClip: 'text',
    WebkitTextFillColor: 'transparent',
    marginBottom: '8px',
  },
  subtitle: {
    color: '#94a3b8',
    fontSize: '1.1rem',
  },
  section: {
    background: '#1e293b',
    borderRadius: '12px',
    padding: '24px',
    marginBottom: '24px',
  },
  sectionTitle: {
    fontSize: '1.25rem',
    fontWeight: 600,
    color: '#f1f5f9',
    marginBottom: '16px',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  statusBadge: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
    padding: '4px 12px',
    borderRadius: '9999px',
    fontSize: '0.875rem',
    fontWeight: 500,
  },
  statusHealthy: {
    background: '#065f46',
    color: '#34d399',
  },
  statusError: {
    background: '#7f1d1d',
    color: '#fca5a5',
  },
  statusLoading: {
    background: '#1e3a5f',
    color: '#60a5fa',
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
    gap: '12px',
  },
  card: {
    background: '#0f172a',
    borderRadius: '8px',
    padding: '16px',
  },
  cardLabel: {
    fontSize: '0.75rem',
    color: '#64748b',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.05em',
    marginBottom: '4px',
  },
  cardValue: {
    fontSize: '1.25rem',
    fontWeight: 600,
    color: '#e2e8f0',
  },
  button: {
    background: '#3b82f6',
    color: 'white',
    border: 'none',
    padding: '10px 20px',
    borderRadius: '8px',
    fontSize: '0.875rem',
    fontWeight: 500,
    cursor: 'pointer',
    transition: 'background 0.2s',
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse' as const,
  },
  th: {
    textAlign: 'left' as const,
    padding: '12px',
    borderBottom: '1px solid #334155',
    color: '#94a3b8',
    fontSize: '0.875rem',
    fontWeight: 500,
  },
  td: {
    padding: '12px',
    borderBottom: '1px solid #1e293b',
    color: '#e2e8f0',
  },
  roleBadge: {
    display: 'inline-block',
    padding: '2px 8px',
    borderRadius: '4px',
    fontSize: '0.75rem',
    fontWeight: 500,
  },
  roleAdmin: {
    background: '#7c3aed',
    color: '#e9d5ff',
  },
  roleUser: {
    background: '#0891b2',
    color: '#cffafe',
  },
  error: {
    background: '#7f1d1d',
    color: '#fca5a5',
    padding: '12px',
    borderRadius: '8px',
    marginBottom: '16px',
  },
  input: {
    background: '#0f172a',
    border: '1px solid #334155',
    borderRadius: '6px',
    padding: '8px 12px',
    color: '#e2e8f0',
    fontSize: '0.875rem',
    marginRight: '8px',
    width: '200px',
  },
  form: {
    display: 'flex',
    gap: '12px',
    marginBottom: '16px',
    flexWrap: 'wrap' as const,
  },
};

function App() {
  // Health status
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);
  const [healthLoading, setHealthLoading] = useState(true);

  // Users
  const [users, setUsers] = useState<User[]>([]);
  const [usersError, setUsersError] = useState<string | null>(null);
  const [usersLoading, setUsersLoading] = useState(true);
  const [authToken, setAuthToken] = useState('Bearer test');

  // New user form
  const [newUserName, setNewUserName] = useState('');
  const [newUserEmail, setNewUserEmail] = useState('');

  // Current session: the browser sends the session cookie, so the client is called without it
  const [session, setSession] = useState<Session | null>(null);
  useEffect(() => {
    userApi.getSession({}).then(setSession, () => setSession(null));
  }, []);

  // Fetch health status
  useEffect(() => {
    const fetchHealth = async () => {
      try {
        const status = await healthApi.check({});
        setHealth(status);
        setHealthError(null);
      } catch (err) {
        setHealthError(err instanceof Error ? err.message : 'Failed to fetch health');
      } finally {
        setHealthLoading(false);
      }
    };
    fetchHealth();
  }, []);

  // Fetch users
  const fetchUsers = async () => {
    setUsersLoading(true);
    try {
      // userApi expects auth header to be set - we'll use fetch directly for now
      const res = await fetch('/api/users', {
        headers: { Authorization: authToken },
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || 'Failed to fetch users');
      }
      const data: UserListResponse = await res.json();
      setUsers(data.users);
      setUsersError(null);
    } catch (err) {
      setUsersError(err instanceof Error ? err.message : 'Failed to fetch users');
    } finally {
      setUsersLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, [authToken]);

  // Create user
  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUserName || !newUserEmail) return;

    try {
      const res = await fetch('/api/users', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: authToken,
        },
        body: JSON.stringify({ name: newUserName, email: newUserEmail }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || 'Failed to create user');
      }
      setNewUserName('');
      setNewUserEmail('');
      fetchUsers();
    } catch (err) {
      setUsersError(err instanceof Error ? err.message : 'Failed to create user');
    }
  };

  return (
    <div style={styles.container}>
      {/* Header */}
      <header style={styles.header}>
        <h1 style={styles.title}>micro-contracts</h1>
        <p style={styles.subtitle}>
          Contract-first API development with type-safe code generation
        </p>
      </header>

      {/* Health Check Section */}
      <section style={styles.section}>
        <h2 style={styles.sectionTitle}>
          🏥 Health Check
          <span
            style={{
              ...styles.statusBadge,
              ...(healthLoading
                ? styles.statusLoading
                : health?.status === 'healthy'
                ? styles.statusHealthy
                : styles.statusError),
            }}
          >
            {healthLoading ? '...' : health?.status || 'error'}
          </span>
        </h2>
        {healthError && <div style={styles.error}>{healthError}</div>}
        {health && (
          <div style={styles.grid}>
            <div style={styles.card}>
              <div style={styles.cardLabel}>Status</div>
              <div style={styles.cardValue}>{health.status}</div>
            </div>
            <div style={styles.card}>
              <div style={styles.cardLabel}>Version</div>
              <div style={styles.cardValue}>{health.version || 'N/A'}</div>
            </div>
            <div style={styles.card}>
              <div style={styles.cardLabel}>Timestamp</div>
              <div style={styles.cardValue}>
                {health.timestamp
                  ? new Date(health.timestamp).toLocaleTimeString()
                  : 'N/A'}
              </div>
            </div>
          </div>
        )}
      </section>

      {/* Session Section */}
      <section style={styles.section}>
        <h2 style={styles.sectionTitle}>🔑 Session</h2>
        <div style={styles.cardValue}>
          {session ? `User ${session.userId} until ${session.expiresAt}` : 'No session'}
        </div>
      </section>

      {/* Users Section */}
      <section style={styles.section}>
        <h2 style={styles.sectionTitle}>👥 Users</h2>

        {/* Auth Token Input */}
        <div style={{ marginBottom: '16px' }}>
          <label style={{ color: '#94a3b8', fontSize: '0.875rem', marginRight: '8px' }}>
            Auth Token:
          </label>
          <input
            type="text"
            value={authToken}
            onChange={(e) => setAuthToken(e.target.value)}
            style={{ ...styles.input, width: '300px' }}
            placeholder="Bearer test"
          />
          <span style={{ color: '#64748b', fontSize: '0.75rem' }}>
            Try "Bearer admin" for admin endpoints
          </span>
        </div>

        {/* Create User Form */}
        <form style={styles.form} onSubmit={handleCreateUser}>
          <input
            type="text"
            value={newUserName}
            onChange={(e) => setNewUserName(e.target.value)}
            style={styles.input}
            placeholder="Name"
          />
          <input
            type="email"
            value={newUserEmail}
            onChange={(e) => setNewUserEmail(e.target.value)}
            style={styles.input}
            placeholder="Email"
          />
          <button type="submit" style={styles.button}>
            Add User
          </button>
          <button type="button" onClick={fetchUsers} style={{ ...styles.button, background: '#475569' }}>
            Refresh
          </button>
        </form>

        {usersError && <div style={styles.error}>{usersError}</div>}

        {usersLoading ? (
          <p style={{ color: '#64748b' }}>Loading users...</p>
        ) : (
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>ID</th>
                <th style={styles.th}>Name</th>
                <th style={styles.th}>Email</th>
                <th style={styles.th}>Role</th>
                <th style={styles.th}>Created</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id}>
                  <td style={styles.td}>{user.id}</td>
                  <td style={styles.td}>{user.name}</td>
                  <td style={styles.td}>{user.email}</td>
                  <td style={styles.td}>
                    <span
                      style={{
                        ...styles.roleBadge,
                        ...(user.role === 'admin' ? styles.roleAdmin : styles.roleUser),
                      }}
                    >
                      {user.role}
                    </span>
                  </td>
                  <td style={styles.td}>
                    {new Date(user.createdAt).toLocaleDateString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* API Info */}
      <section style={styles.section}>
        <h2 style={styles.sectionTitle}>📚 Generated API Endpoints</h2>
        <div style={{ color: '#94a3b8', fontSize: '0.875rem', lineHeight: 1.6 }}>
          <p>All these endpoints were generated from OpenAPI spec:</p>
          <ul style={{ marginTop: '8px', paddingLeft: '20px' }}>
            <li><code>GET /api/health</code> - Health check (public)</li>
            <li><code>GET /api/users</code> - List users (auth required)</li>
            <li><code>POST /api/users</code> - Create user (auth required)</li>
            <li><code>GET /api/users/:id</code> - Get user (auth required)</li>
            <li><code>PUT /api/users/:id</code> - Update user (auth required)</li>
            <li><code>DELETE /api/users/:id</code> - Delete user (admin required)</li>
            <li><code>GET /api/admin/stats</code> - System stats (admin required)</li>
            <li><code>GET /api/tenant/data</code> - Tenant data (tenant isolation)</li>
          </ul>
        </div>
      </section>
    </div>
  );
}

export default App;


import { useState, useEffect } from 'react';
import api from '../services/api';

export default function PlansPage() {
  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const data = await api.getPlans();
        setPlans(data);
      } catch {}
      setLoading(false);
    })();
  }, []);

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh' }}>
      <div className="spinner" style={{ width: 28, height: 28, borderWidth: 3 }} />
    </div>
  );

  return (
    <>
      <div className="page-header">
        <h2>Subscription Plans</h2>
        <p>Choose the plan that fits your needs</p>
      </div>

      <div className="plan-grid">
        {plans.map((plan, i) => (
          <div className="plan-card" key={i}>
            <div className="plan-name">{plan.name}</div>
            <div className="plan-price">${plan.price}</div>
            <div className="plan-period">per {plan.duration_days} days</div>
            <ul className="plan-features">
              <li>{plan.max_accounts_per_day} accounts/day</li>
              <li>{plan.max_accounts_per_week} accounts/week</li>
              <li>{plan.max_accounts_per_month} accounts/month</li>
              {plan.max_devices && <li>Up to {plan.max_devices} devices</li>}
            </ul>
            <button className="btn btn-primary btn-block" onClick={() => { window.open(`${api.baseUrl?.replace('/api', '')}/user/subscription`, '_blank'); }}>
              Subscribe →
            </button>
          </div>
        ))}
      </div>

      {plans.length === 0 && (
        <div className="card">
          <div className="card-body">
            <div className="empty-state">
              <div className="icon">📋</div>
              <h3>No Plans Available</h3>
              <p>Plans will appear here once the admin adds them.</p>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

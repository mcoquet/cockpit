import { useState, useEffect } from 'react';

// Apply dev mode class if running in development
if (new URLSearchParams(window.location.search).has('dev')) {
  document.body.classList.add('dev');
}

interface DailyActivity {
  date: string;
  messageCount: number;
  sessionCount: number;
  toolCallCount: number;
}

interface ClaudeStats {
  today: DailyActivity | null;
  last7Days: {
    messageCount: number;
    sessionCount: number;
    toolCallCount: number;
  };
  last30Days: {
    messageCount: number;
    sessionCount: number;
    toolCallCount: number;
  };
  lastComputedDate: string | null;
}

interface ServiceStatus {
  status: 'operational' | 'degraded' | 'outage' | 'unknown';
  message: string;
}

export default function Status() {
  const [stats, setStats] = useState<ClaudeStats | null>(null);
  const [serviceStatus, setServiceStatus] = useState<ServiceStatus>({
    status: 'unknown',
    message: 'Checking...',
  });

  useEffect(() => {
    window.cockpit.getClaudeStats?.().then(setStats);
    window.cockpit.getServiceStatus?.().then(setServiceStatus);
  }, []);

  const formatNumber = (n: number) => n.toLocaleString();

  const getStatusColor = (status: ServiceStatus['status']) => {
    switch (status) {
      case 'operational':
        return '#27c93f';
      case 'degraded':
        return '#ffbd2e';
      case 'outage':
        return '#ff5f56';
      default:
        return '#888';
    }
  };

  const getStatusLabel = (status: ServiceStatus['status']) => {
    switch (status) {
      case 'operational':
        return 'All Systems Operational';
      case 'degraded':
        return 'Degraded Performance';
      case 'outage':
        return 'Service Outage';
      default:
        return 'Status Unknown';
    }
  };

  return (
    <div className="status">
      <h1>Claude Status</h1>

      <div className="status-card">
        <div className="card-title">Service Status</div>
        <div className="service-status">
          <div
            className="status-indicator"
            style={{ backgroundColor: getStatusColor(serviceStatus.status) }}
          />
          <div className="status-text">
            <div className="status-label">{getStatusLabel(serviceStatus.status)}</div>
          </div>
        </div>
      </div>

      <div className="stats-row">
        <div className="status-card">
          <div className="card-title">Last 7 Days</div>
          {stats ? (
            <div className="stats-vertical">
              <div className="stat-row">
                <span className="stat-label">Messages</span>
                <span className="stat-value">{formatNumber(stats.last7Days.messageCount)}</span>
              </div>
              <div className="stat-row">
                <span className="stat-label">Sessions</span>
                <span className="stat-value">{formatNumber(stats.last7Days.sessionCount)}</span>
              </div>
              <div className="stat-row">
                <span className="stat-label">Tool Calls</span>
                <span className="stat-value">{formatNumber(stats.last7Days.toolCallCount)}</span>
              </div>
            </div>
          ) : (
            <div className="no-data">Loading...</div>
          )}
        </div>

        <div className="status-card">
          <div className="card-title">Last 30 Days</div>
          {stats ? (
            <div className="stats-vertical">
              <div className="stat-row">
                <span className="stat-label">Messages</span>
                <span className="stat-value">{formatNumber(stats.last30Days.messageCount)}</span>
              </div>
              <div className="stat-row">
                <span className="stat-label">Sessions</span>
                <span className="stat-value">{formatNumber(stats.last30Days.sessionCount)}</span>
              </div>
              <div className="stat-row">
                <span className="stat-label">Tool Calls</span>
                <span className="stat-value">{formatNumber(stats.last30Days.toolCallCount)}</span>
              </div>
            </div>
          ) : (
            <div className="no-data">Loading...</div>
          )}
        </div>
      </div>
    </div>
  );
}

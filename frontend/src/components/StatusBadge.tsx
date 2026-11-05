type BadgeStatus =
  | 'queued' | 'running' | 'apollo_enriching' | 'contact_fallback' | 'cleaning' | 'done' | 'error'
  | 'Hot' | 'Warm' | 'Low'
  | 'pending' | 'approved' | 'rejected' | 'pushed';

type StyleDef = { bg: string; color: string; border: string; dot: string };

const STYLES: Record<string, StyleDef> = {
  queued:           { bg:'#f8fafc', color:'#475569', border:'#e2e8f0', dot:'#94a3b8' },
  running:          { bg:'#eff6ff', color:'#1d4ed8', border:'#bfdbfe', dot:'#3b82f6' },
  apollo_enriching: { bg:'#eef2ff', color:'#4338ca', border:'#c7d2fe', dot:'#47549a' },
  contact_fallback: { bg:'#fffbeb', color:'#b45309', border:'#fde68a', dot:'#f59e0b' },
  cleaning:         { bg:'#faf5ff', color:'#3b4a8c', border:'#e9d5ff', dot:'#a855f7' },
  done:             { bg:'#f0fdf4', color:'#15803d', border:'#bbf7d0', dot:'#22c55e' },
  error:            { bg:'#fef2f2', color:'#b91c1c', border:'#fecaca', dot:'#ef4444' },
  Hot:              { bg:'#fff1f2', color:'#be123c', border:'#fecdd3', dot:'#f43f5e' },
  Warm:             { bg:'#fff7ed', color:'#c2410c', border:'#fed7aa', dot:'#f97316' },
  Low:              { bg:'#f8fafc', color:'#475569', border:'#e2e8f0', dot:'#94a3b8' },
  pending:          { bg:'#fffbeb', color:'#b45309', border:'#fde68a', dot:'#f59e0b' },
  approved:         { bg:'#f0fdf4', color:'#15803d', border:'#bbf7d0', dot:'#22c55e' },
  rejected:         { bg:'#fef2f2', color:'#b91c1c', border:'#fecaca', dot:'#ef4444' },
  pushed:           { bg:'#faf5ff', color:'#3b4a8c', border:'#e9d5ff', dot:'#a855f7' },
};

const LABELS: Record<string, string> = {
  queued:           'Queued',
  running:          'Scraping',
  apollo_enriching: 'Apollo Enrichment',
  contact_fallback: 'Fallback Search',
  cleaning:         'Cleaning',
  done:             'Done',
  error:            'Error',
  Hot:              'Hot',
  Warm:             'Warm',
  Low:              'Low',
  pending:          'Pending',
  approved:         'Approved',
  rejected:         'Rejected',
  pushed:           'In HubSpot',
};

export default function StatusBadge({ status, size = 'sm' }: { status: string; size?: 'sm' | 'md' }) {
  const s    = STYLES[status] ?? STYLES['queued'];
  const text = LABELS[status] ?? status;
  return (
    <span className="inline-flex items-center gap-1.5 font-semibold rounded-full whitespace-nowrap"
          style={{
            background: s.bg,
            color:      s.color,
            border:    `1px solid ${s.border}`,
            padding:    size === 'md' ? '4px 12px' : '2px 9px',
            fontSize:   size === 'md' ? '13px' : '11px',
          }}>
      <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{background: s.dot}}/>
      {text}
    </span>
  );
}

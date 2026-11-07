import { useEffect, useRef, useState } from 'react';
import { Bell, Check, ExternalLink, X } from 'lucide-react';
import { confirmRenewalReminder, type Subscription } from '@/lib/db';
import { renewalLink, renewalMessage, type getRenewals, type RenewalGroup } from '@/lib/renewals';
import { parseAnyDate } from '@/lib/expiration';
import { cn } from '@/lib/utils';

type View = 'pending' | 'review' | 'confirmed';

type Props = {
  renewals: ReturnType<typeof getRenewals>;
  template: string;
  onEditContact: (subscription: Subscription) => void;
  onClose: () => void;
};

const confirmationTime = new Intl.DateTimeFormat('hr-HR', { dateStyle: 'short', timeStyle: 'short' });
const expirationLabel = new Intl.DateTimeFormat('hr-HR', { dateStyle: 'short' });
const lineKey = (id: string, date: string) => JSON.stringify([id, date]);

function urgency(days: number) {
  if (days === 0) return 'Danas';
  if (days === 1) return 'Sutra';
  return `Za ${days} dana`;
}

export default function RenewalReminders({ renewals, template, onEditContact, onClose }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [view, setView] = useState<View>('pending');
  const [selectedKey, setSelectedKey] = useState<string>();
  const [opened, setOpened] = useState<{ group: RenewalGroup; message: string }>();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [savedLines, setSavedLines] = useState<Set<string>>(() => new Set());
  const { groups, review, confirmed } = renewals;
  const pending = groups.flatMap(group => {
    const lines = group.lines.filter(line => !savedLines.has(lineKey(line.subscription.id, line.date)));
    return lines.length ? [{ ...group, lines }] : [];
  });
  const selected = pending.find(group => group.key === selectedKey) ?? pending[0];
  const group = opened?.group ?? selected;
  const message = group ? opened?.message ?? renewalMessage(group, template) : '';
  const tabs: { id: View; label: string; count: number }[] = [
    { id: 'pending', label: 'Za poslati', count: pending.length },
    { id: 'review', label: 'Provjeri kontakt', count: review.length },
    { id: 'confirmed', label: 'Potvrđeno', count: confirmed.length },
  ];

  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);

  function choose(key?: string) {
    setSelectedKey(key);
    setOpened(undefined);
    setNotice('');
    setError('');
  }

  async function copyMessage() {
    try {
      await navigator.clipboard.writeText(message);
      setNotice('Poruka je kopirana. Zalijepi je u Viber.');
    } catch {
      setNotice('Označi i kopiraj tekst iz pregleda pa ga zalijepi u Viber.');
    }
  }

  async function confirm() {
    if (!opened || saving) return;
    const lines = opened.group.lines.map(line => ({ id: line.subscription.id, date: line.date }));
    setSaving(true);
    setError('');
    try {
      await confirmRenewalReminder(lines, opened.group.recipient.channel);
      setSavedLines(previous => new Set([...previous, ...lines.map(line => lineKey(line.id, line.date))]));
      setOpened(undefined);
      setSelectedKey(undefined);
      setNotice(`Podsjetnik za ${opened.group.name} je evidentiran.`);
    } catch {
      setError('Potvrda nije spremljena. Pokušaj spremiti ponovno. Poruku ne treba slati ponovno.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <dialog
      ref={dialog}
      className="customer-drawer"
      aria-labelledby="renewals-title"
      onCancel={event => {
        event.preventDefault();
        if (!saving) onClose();
      }}
    >
      <div className="drawer-heading">
        <div>
          <span className="eyebrow">OBNOVA PRETPLATA</span>
          <h2 id="renewals-title" className="flex items-center gap-2"><Bell size={20} /> Podsjetnici za obnovu</h2>
          <p>Aktivne pretplate koje istječu od danas do sljedećih 7 dana.</p>
        </div>
        <button autoFocus type="button" className="btn btn-ghost" aria-label="Zatvori podsjetnike" onClick={onClose} disabled={saving}><X size={20} /></button>
      </div>

      <nav aria-label="Status podsjetnika" className="mb-5 flex flex-wrap gap-2">
        {tabs.map(tab => (
          <button
            key={tab.id}
            type="button"
            className={cn('btn btn-sm', view === tab.id ? 'btn-primary' : 'btn-ghost')}
            aria-pressed={view === tab.id}
            disabled={saving}
            onClick={() => setView(tab.id)}
          >
            {tab.label} ({tab.count})
          </button>
        ))}
      </nav>

      {view === 'pending' && group && (
        <div className="space-y-4">
          <div className="detail-section">
            <label className="block text-sm font-semibold" htmlFor="renewal-recipient">Primatelj</label>
            <select
              id="renewal-recipient"
              className="glass-input mt-2 w-full"
              value={group.key}
              disabled={saving || Boolean(opened)}
              onChange={event => choose(event.target.value)}
            >
              {opened && !pending.some(item => item.key === opened.group.key) && (
                <option value={opened.group.key}>{opened.group.name}</option>
              )}
              {pending.map(item => (
                <option key={item.key} value={item.key}>{item.name} · {urgency(item.lines[0].days)}</option>
              ))}
            </select>
            <p className="mt-2 break-words">{group.recipient.channel} · {group.recipient.address}</p>
            <ul className="mt-2 space-y-1 text-sm">
              {group.lines.map(line => (
                <li key={line.subscription.id}>{line.subscription.app || 'Pretplata'} · {line.label} · {urgency(line.days)}</li>
              ))}
            </ul>
          </div>

          <div className="detail-section">
            <h3>Pregled poruke</h3>
            <p className="mt-2 whitespace-pre-wrap break-words">{message}</p>
          </div>

          <div className="flex flex-wrap gap-2">
            {group.recipient.channel === 'Viber' && (
              <button type="button" className="btn btn-ghost" onClick={copyMessage} disabled={saving}>Kopiraj poruku</button>
            )}
            {!saving && (
              <a
                className={cn('btn', opened ? 'btn-ghost' : 'btn-primary')}
                href={renewalLink(group.recipient, message)}
                target={group.recipient.channel === 'WhatsApp' || group.recipient.channel === 'Telegram' ? '_blank' : undefined}
                rel="noopener noreferrer"
                onClick={() => {
                  setOpened({ group, message });
                  setError('');
                }}
              >
                <ExternalLink size={16} /> Otvori {group.recipient.channel}
              </a>
            )}
            {opened && (
              <>
                <button type="button" className="btn btn-primary" onClick={confirm} disabled={saving}>
                  <Check size={16} /> {saving ? 'Spremanje…' : 'Potvrdi slanje i nastavi'}
                </button>
                <button type="button" className="btn btn-ghost" onClick={() => choose(group.key)} disabled={saving}>Odustani od potvrde</button>
              </>
            )}
          </div>
          {opened && <p className="text-sm text-slate-400">Potvrdi nakon što pošalješ poruku u {group.recipient.channel === 'E-mail' ? 'aplikaciji za e-poštu' : 'razgovoru'}.</p>}
        </div>
      )}
      {view === 'pending' && !group && <p className="detail-section">Nema podsjetnika spremnih za slanje.</p>}

      {view === 'review' && (
        review.length ? <ul className="space-y-2">
          {review.map(({ line, reason }) => (
            <li key={line.subscription.id} className="detail-section flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3>{line.subscription.name || 'Bez imena'} · {line.label}</h3>
                <p>{reason}</p>
              </div>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => onEditContact(line.subscription)}>Uredi kontakt</button>
            </li>
          ))}
        </ul> : <p className="detail-section">Nema kontakata za provjeru.</p>
      )}

      {view === 'confirmed' && (
        <>
          <p className="mb-3 text-sm text-slate-400">Potvrde za pojedine pretplate u posljednjih 30 dana.</p>
          {confirmed.length ? <ul className="space-y-2">
            {confirmed.map(({ subscription, date, channel, confirmedAt }) => {
              const expiration = parseAnyDate(date);
              return (
                <li key={lineKey(subscription.id, date)} className="detail-section">
                  <h3>{subscription.name} · {expiration ? expirationLabel.format(expiration) : date}</h3>
                  <p>{subscription.app || 'Pretplata'} · {channel} · Potvrđeno {confirmationTime.format(confirmedAt)}</p>
                </li>
              );
            })}
          </ul> : <p className="detail-section">Nema potvrđenih podsjetnika.</p>}
        </>
      )}

      {notice && <p role="status" className="mt-3 text-sm text-emerald-300">{notice}</p>}
      {error && <p role="alert" className="mt-3 text-sm text-red-300">{error}</p>}
    </dialog>
  );
}

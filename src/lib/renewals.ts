import { format } from 'date-fns';
import type { Subscription } from './db';
import { getDaysUntilExpiration, isExpiringSoon, parseAnyDate } from './expiration';

export const DEFAULT_RENEWAL_TEMPLATE =
  'Bok, {ime}! Bliži se istek pretplate ({datum}). Ako želiš produljiti pretplatu, samo odgovori na ovu poruku.';

export type ReminderChannel = 'WhatsApp' | 'Viber' | 'Telegram' | 'E-mail';
type Recipient = { channel: ReminderChannel; address: string };

export type RenewalLine = {
  subscription: Subscription;
  date: string;
  label: string;
  days: number;
};

export type RenewalGroup = {
  key: string;
  name: string;
  recipient: Recipient;
  lines: RenewalLine[];
};

function getRecipient(subscription: Subscription): Recipient | string {
  const channel = (subscription.contact || '').toUpperCase().replace(/[\s-]/g, '');
  if (channel === 'EMAIL') {
    const email = String(subscription.email || '').trim();
    if (!/^[^\s@,;<>]+@[a-z\d.-]+\.[a-z\d]{2,}$/i.test(email)) {
      return 'Unesi jednu valjanu adresu e-pošte.';
    }
    return { channel: 'E-mail', address: email };
  }

  const phoneChannels = { WHATSAPP: 'WhatsApp', VIBER: 'Viber', TELEGRAM: 'Telegram' } as const;
  if (!Object.hasOwn(phoneChannels, channel)) return 'Odaberi podržani kanal za podsjetnik.';

  const phone = String(subscription.phone || '').trim().replace(/^(0[1-9]\d?)\s*\/\s*(\d[\d\s-]{4,10})$/, '$1 $2');
  const entries = phone.split(/:::|[,;/\n]/).map(value => value.trim()).filter(Boolean);
  if (!entries.length) return 'Nedostaje broj telefona.';

  const addresses = new Set<string>();
  for (const entry of entries) {
    if (!/^\+?[\d\s().-]+$/.test(entry)) return 'Provjeri format broja telefona.';
    let number = entry.replace(/[^\d]/g, '');
    if (!entry.startsWith('+')) {
      if (number.startsWith('00')) number = number.slice(2);
      else if (number.startsWith('0')) number = '385' + number.slice(1);
      else if (!number.startsWith('385')) return 'Dodaj međunarodni pozivni broj (npr. +385).';
    }
    if (!/^[1-9]\d{7,14}$/.test(number)) return 'Provjeri format broja telefona.';
    addresses.add('+' + number);
  }
  if (addresses.size !== 1) return 'Odaberi jedan broj za ovaj kontakt.';
  return { channel: phoneChannels[channel as keyof typeof phoneChannels], address: [...addresses][0] };
}

const nameKey = (name: string) => name.normalize('NFC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('hr');
const recipientKey = (recipient: Recipient) => recipient.address.toLowerCase();

export function getRenewals(subscriptions: Subscription[], today: Date) {
  const pending = new Map<string, RenewalGroup>();
  const review: { line: RenewalLine; reason: string }[] = [];
  const confirmed: { subscription: Subscription; date: string; channel: ReminderChannel; confirmedAt: number }[] = [];
  const contacts = new Map<string, Set<string>>();
  const active = subscriptions.filter(subscription => !subscription.isArchived);
  const recentSince = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 29).getTime();

  for (const subscription of subscriptions) {
    for (const [date, confirmation] of Object.entries(subscription.renewalReminders ?? {})) {
      if (confirmation.confirmedAt >= recentSince) confirmed.push({ subscription, date, ...confirmation });
    }
  }

  for (const subscription of active) {
    const recipient = getRecipient(subscription);
    if (typeof recipient === 'string') continue;
    const name = nameKey(subscription.name || '');
    if (!name) continue;
    const key = recipientKey(recipient);
    const names = contacts.get(key) ?? new Set<string>();
    names.add(name);
    contacts.set(key, names);
  }

  for (const subscription of active) {
    const days = getDaysUntilExpiration(subscription.expirationDate, today);
    if (!isExpiringSoon(days)) continue;
    const date = parseAnyDate(subscription.expirationDate)!;
    const line = { subscription, days, date: format(date, 'yyyy-MM-dd'), label: format(date, 'dd.MM.yyyy.') };
    if (subscription.renewalReminders?.[line.date]) continue;
    const recipient = getRecipient(subscription);
    const name = (subscription.name || '').trim();
    if (typeof recipient === 'string') {
      review.push({ line, reason: recipient });
      continue;
    }
    if (!name || (contacts.get(recipientKey(recipient))?.size ?? 0) > 1) {
      review.push({ line, reason: name ? 'Isti kontakt ima različita imena.' : 'Nedostaje ime korisnika.' });
      continue;
    }

    const key = JSON.stringify([nameKey(name), recipient.channel, recipientKey(recipient)]);
    const group = pending.get(key) ?? { key, name, recipient, lines: [] };
    group.lines.push(line);
    pending.set(key, group);
  }

  const groups = [...pending.values()];
  for (const group of groups) group.lines.sort((a, b) => a.days - b.days);
  groups.sort((a, b) => a.lines[0].days - b.lines[0].days || a.name.localeCompare(b.name, 'hr'));
  review.sort((a, b) => a.line.days - b.line.days);
  confirmed.sort((a, b) => b.confirmedAt - a.confirmedAt);
  return { groups, review, confirmed };
}

export function renewalMessage(group: RenewalGroup, template: string): string {
  const name = group.name.split(/\s+/)[0];
  const dates = group.lines.length === 1
    ? group.lines[0].label
    : group.lines.map((line, index) => `uređaj ${index + 1}: ${line.label}`).join(', ');
  return template.replace(/\{(ime|datum)\}/gi, (_, token: string) =>
    token.toLowerCase() === 'ime' ? name : dates);
}

export function renewalLink({ channel, address }: Recipient, message: string): string {
  const text = encodeURIComponent(message);
  switch (channel) {
    case 'WhatsApp': return `https://wa.me/${address.slice(1)}?text=${text}`;
    case 'Telegram': return `https://t.me/${address}?text=${text}`;
    case 'Viber': return `viber://chat?number=${encodeURIComponent(address)}`;
    case 'E-mail': return `mailto:${encodeURIComponent(address).replace('%40', '@')}?subject=Podsjetnik%20za%20obnovu&body=${text}`;
  }
}

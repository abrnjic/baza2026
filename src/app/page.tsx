"use client";
import { useEffect, useState, useMemo, useRef } from 'react';
import { subscribeToSubscriptions, updateSubscription, deleteSubscription, addSubscription, Subscription, subscribeToSettings, updateSettings, AppSettings, batchSyncSubscriptions, batchImportSubscriptions } from '@/lib/db';
import { auth } from '@/lib/firebase';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { useRouter } from 'next/navigation';
import { Search, Bell, Download, Upload, Plus, AlertTriangle, MessageSquare, Bot, AlertCircle, LogOut, Settings as SettingsIcon, X, Check, Trash2, Edit, Archive, ArchiveRestore, ArrowUp, ArrowDown, Share, TrendingUp, Copy } from 'lucide-react';
import { FaWhatsapp, FaViber, FaTelegramPlane } from 'react-icons/fa';
import { MdEmail, MdMessage } from 'react-icons/md';
import { SiSignal } from 'react-icons/si';
import { parseISO, differenceInDays, isValid, format, addMonths, addYears, startOfMonth, endOfMonth, subMonths, isWithinInterval } from 'date-fns';
import { cn } from '@/lib/utils';
import * as xlsx from 'xlsx';
import { callGemini, callGeminiChat, GeminiMessage, GeminiTool } from '@/lib/gemini';

const appNameKey = (name: string) => {
  const key = name.normalize('NFC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('hr');
  // The old name remains compatible with existing subscription records.
  return key === 'ibo bob player' ? 'bob player' : key;
};

const formatAppName = (name: string, appNames: Record<string, string> = {}) => {
  const key = appNameKey(name);
  const label = Object.prototype.hasOwnProperty.call(appNames, key) ? appNames[key] : name;
  return appNameKey(label || name)
    .replace(/(^|[\s-])([\p{L}\p{N}])/gu, (_, separator: string, first: string) => separator + first.toLocaleUpperCase('hr'));
};

// Keep stored values intact so existing subscriptions retain their app selection.
const sortedUniqueApps = (names: string[], appNames: Record<string, string> = {}) => {
  const seen = new Set<string>();
  return names.filter(name => {
    const key = appNameKey(formatAppName(name, appNames));
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).sort((a, b) => formatAppName(a, appNames).localeCompare(formatAppName(b, appNames), 'hr', { numeric: true }));
};

const ContactIcon = ({ contact }: { contact: string }) => {
  const c = contact?.toUpperCase() || '';
  if (c.includes('WHATS APP') || c.includes('WHATSAPP')) return <FaWhatsapp className="text-[#25D366] shrink-0" size={16} title={contact} />;
  if (c.includes('VIBER')) return <FaViber className="text-[#7360F2] shrink-0" size={16} title={contact} />;
  if (c.includes('TELEGRAM')) return <FaTelegramPlane className="text-[#0088cc] shrink-0" size={16} title={contact} />;
  if (c.includes('E-MAIL') || c.includes('EMAIL')) return <MdEmail className="text-gray-400 shrink-0" size={16} title={contact} />;
  if (c.includes('MESSANGER') || c.includes('MESSENGER')) return <MdMessage className="text-[#00B2FF] shrink-0" size={16} title={contact} />;
  if (c.includes('SIGNAL')) return <SiSignal className="text-[#3A76F0] shrink-0" size={16} title={contact} />;
  return <span className="text-slate-400 text-[10px] uppercase font-bold truncate max-w-[60px]" title={contact}>{contact || '-'}</span>;
};

const parseAnyDate = (dateStr: string): Date | null => {
  if (!dateStr || dateStr === 'NaT') return null;
  
  // If it's an Excel serial number string (e.g., "45337")
  if (/^\d+$/.test(dateStr) && parseInt(dateStr, 10) > 40000) {
    const excelEpoch = new Date(1899, 11, 30); // Excel epoch starts at Dec 30 1899
    const d = new Date(excelEpoch.getTime() + parseInt(dateStr, 10) * 86400000);
    if (isValid(d)) return d;
  }

  // Try standard parse
  let d = new Date(dateStr);
  if (isValid(d)) return d;
  
  // Try DD.MM.YYYY, DD-MM-YYYY, or DD/MM/YYYY
  const parts = dateStr.split(/[\.\-\/]/);
  if (parts.length === 3) {
    if (parts[0].length === 4) {
      d = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
    } else {
      d = new Date(parseInt(parts[2], 10), parseInt(parts[1], 10) - 1, parseInt(parts[0], 10));
    }
    if (isValid(d)) return d;
  }
  return null;
};

export type SyncAction = 'NEW' | 'UPDATE' | 'UNCHANGED';

export const generateMessageLink = (phone: string | number | undefined, message: string, contactType?: string) => {
  if (!phone) return "#";
  let cleanPhone = String(phone).replace(/[^0-9+]/g, '');
  if (cleanPhone.startsWith('00')) cleanPhone = '+' + cleanPhone.substring(2);
  if (cleanPhone.startsWith('0')) cleanPhone = '+385' + cleanPhone.substring(1);
  if (!cleanPhone.startsWith('+')) cleanPhone = '+' + cleanPhone;
  
  const cType = (contactType || '').toUpperCase();
  if (cType.includes('VIBER')) {
    return `viber://chat?number=${cleanPhone.replace('+', '')}`;
  }
  if (cType.includes('TELEGRAM')) {
    return `https://t.me/+${cleanPhone.replace('+', '')}`;
  }
  
  // Default WhatsApp
  return `https://wa.me/${cleanPhone.replace('+', '')}?text=${encodeURIComponent(message)}`;
};

export interface SyncItem {
  action: SyncAction;
  original?: Subscription;
  updated: Partial<Subscription>;
  changes?: string[];
  selected?: boolean;
}

export default function Dashboard() {
  const router = useRouter();
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [authLoading, setAuthLoading] = useState(true);

  const [data, setData] = useState<Subscription[]>([]);
  const [settings, setSettings] = useState<AppSettings>({ apps: [], contacts: [] });
  const [detailId, setDetailId] = useState<string | null>(null);
  const detailDialog = useRef<HTMLDialogElement>(null);
  const detail = data.find(item => item.id === detailId);
  useEffect(() => {
    if (detailId && detailDialog.current && !detailDialog.current.open) detailDialog.current.showModal();
  }, [detailId]);
  const [search, setSearch] = useState('');
  const [expiresSoonFilter, setExpiresSoonFilter] = useState(false);
  const [expiredFilter, setExpiredFilter] = useState(false);
  const [appFilter, setAppFilter] = useState('');
  const [sortBy, setSortBy] = useState('expiration');
  const [unpaidFilter, setUnpaidFilter] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [filterStartDate, setFilterStartDate] = useState("");
  const [filterEndDate, setFilterEndDate] = useState("");
  // Modals state
  const [isDeleteModalOpen, setDeleteModalOpen] = useState<string | null>(null);
  const [isEditModalOpen, setEditModalOpen] = useState<Subscription | null>(null);
  const [isNewModalOpen, setNewModalOpen] = useState<boolean | Partial<Subscription>>(false);
  const [isSettingsModalOpen, setSettingsModalOpen] = useState(false);
  const [isAnalyticsModalOpen, setAnalyticsModalOpen] = useState(false);
  const [isManualSyncModalOpen, setManualSyncModalOpen] = useState(false);
  const [selectedForNotification, setSelectedForNotification] = useState<Set<string>>(new Set());
  const [isNotifyModalOpen, setNotifyModalOpen] = useState(false);
  const [isAIModalOpen, setAIModalOpen] = useState(false);
  const [isImportModalOpen, setImportModalOpen] = useState(false);
  const [noteModalContent, setNoteModalContent] = useState<string | null>(null);
  const [importPreviewData, setImportPreviewData] = useState<SyncItem[] | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = (evt) => {
      const bstr = evt.target?.result;
      const wb = xlsx.read(bstr, { type: 'binary' });
      const wsname = wb.SheetNames[0];
      const ws = wb.Sheets[wsname];
      const json = xlsx.utils.sheet_to_json(ws);
      
      const preview: SyncItem[] = [];
      
      json.forEach((row: any) => {
        const name = (row['IME I PREZIME'] || '').toString().trim();
        const contact = (row['KONTAKT'] || '').toString().trim();
        const app = (row['APLIKACIJE'] || '').toString().trim();
        const macAddress = (row['MAC ADRESA'] || '').toString().trim();
        const deviceKey = (row['DEVICE KEY'] || '').toString().trim();
        const note = (row['NAPOMENA'] || '').toString().trim();
        const expirationDate = row['ISTEK'] && row['ISTEK'] !== 'NaT' ? row['ISTEK'].toString() : '';
        
        // Skip empty rows
        if (!name && !macAddress) return;

        // Try to match by MAC or Name
        const match = data.find(sub => 
          (macAddress && sub.macAddress && sub.macAddress.toLowerCase() === macAddress.toLowerCase()) || 
          (name && sub.name && sub.name.toLowerCase() === name.toLowerCase())
        );

        if (match) {
           const changes: string[] = [];
           const updates: Partial<Subscription> = {};
           
           if (name && name !== match.name) { updates.name = name; changes.push(`Ime: ${match.name} -> ${name}`); }
           if (app && app !== match.app) { updates.app = app; changes.push(`Aplikacija: ${match.app} -> ${app}`); }
           if (macAddress && macAddress !== match.macAddress) { updates.macAddress = macAddress; changes.push(`MAC: ${match.macAddress} -> ${macAddress}`); }
           if (deviceKey && deviceKey !== match.deviceKey) { updates.deviceKey = deviceKey; changes.push(`Key: ${match.deviceKey} -> ${deviceKey}`); }
           if (note && note !== match.note) { updates.note = note; changes.push(`Napomena ažurirana`); }
           if (contact && contact !== match.contact) { updates.contact = contact; changes.push(`Kontakt: ${match.contact} -> ${contact}`); }
           if (expirationDate && expirationDate !== match.expirationDate) { updates.expirationDate = expirationDate; changes.push(`Istek: ${match.expirationDate} -> ${expirationDate}`); }
           
           if (changes.length > 0) {
             preview.push({ action: 'UPDATE', original: match, updated: updates, changes, selected: true });
           } else {
             preview.push({ action: 'UNCHANGED', original: match, updated: {} });
           }
        } else {
           preview.push({ 
             action: 'NEW', 
             updated: { name, contact, app, macAddress, deviceKey, note, expirationDate, isPaid: false },
             selected: true
           });
        }
      });
      
      setImportPreviewData(preview);
    };
    reader.readAsBinaryString(file);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const exportToExcel = () => {
    // Map processedData to Croatian headers to match import format
    const exportData = processedData.map(row => ({
      'IME I PREZIME': row.name || '',
      'APLIKACIJE': row.app || '',
      'MAC ADRESA': row.macAddress || '',
      'DEVICE KEY': row.deviceKey || '',
      'ISTEK': row.expirationDate || 'NaT',
      'KONTAKT': row.contact || '',
      'TELEFON': row.phone || '',
      'EMAIL': row.email || '',
      'NAPOMENA': row.note || '',
      'STATUS': row.isPaid ? 'PLAĆENO' : 'NEPLAĆENO',
      'ARHIVIRANO': row.isArchived ? 'DA' : 'NE'
    }));

    const ws = xlsx.utils.json_to_sheet(exportData);
    const wb = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(wb, ws, "Pretplatnici");
    
    // Generate filename with current date
    const dateStr = format(new Date(), 'dd-MM-yyyy');
    xlsx.writeFile(wb, `BazaKorisnika_${dateStr}.xlsx`);
  };

  const handleConfirmSync = async () => {
    if (!importPreviewData) return;
    setIsSyncing(true);
    
    const updates = importPreviewData
      .filter(item => item.action === 'UPDATE' && item.original && item.selected)
      .map(item => ({ id: item.original!.id, data: item.updated }));
      
    const additions = importPreviewData
      .filter(item => item.action === 'NEW' && item.selected)
      .map(item => ({ ...item.updated, id: crypto.randomUUID(), createdAt: Date.now() } as Subscription));
      
    if (updates.length > 0 || additions.length > 0) {
      await batchSyncSubscriptions(updates, additions);
    }
    
    setIsSyncing(false);
    setImportPreviewData(null);
    setImportModalOpen(false);
  };

  const toggleSyncItemSelection = (index: number) => {
    if (!importPreviewData) return;
    const newData = [...importPreviewData];
    newData[index].selected = !newData[index].selected;
    setImportPreviewData(newData);
  };

  useEffect(() => {
    const unsubscribeAuth = onAuthStateChanged(auth, (user) => {
      if (user) {
        setIsAuthenticated(true);
        setAuthLoading(false);
      } else {
        router.push('/login');
      }
    });
    return () => unsubscribeAuth();
  }, [router]);

  useEffect(() => {
    if (!isAuthenticated) return;
    const unsubscribeData = subscribeToSubscriptions((newData) => {
      setData(newData);
    });
    const unsubscribeSettings = subscribeToSettings((newSettings) => {
      setSettings(newSettings);
    });
    return () => {
      unsubscribeData();
      unsubscribeSettings();
    };
  }, [isAuthenticated]);

  const getDaysUntilExpiration = (dateStr: string) => {
    const d = parseAnyDate(dateStr);
    if (!d) return Infinity;
    const now = new Date();
    d.setHours(0,0,0,0);
    now.setHours(0,0,0,0);
    return differenceInDays(d, now);
  };

  const processedData = useMemo(() => {
    let result = data.filter(item => (showArchived ? item.isArchived : !item.isArchived));

    // Search filter (Omni-search)
    if (search) {
      const q = search.trim().toLocaleLowerCase('hr');
      result = result.filter(item => 
        (item.name?.toLowerCase() || '').includes(q) ||
        (item.macAddress?.toLowerCase() || '').includes(q) ||
        (item.app?.toLowerCase() || '').includes(q) ||
        formatAppName(item.app || '', settings.appNames).toLocaleLowerCase('hr').includes(q) ||
        (item.contact?.toLowerCase() || '').includes(q) ||
        (item.email?.toLowerCase() || '').includes(q) ||
        (item.phone?.toLowerCase() || '').includes(q) ||
        (item.note?.toLowerCase() || '').includes(q) ||
        (item.isPaid ? 'plaćeno' : 'nije plaćeno').includes(q)
      );
    }

    // Upcoming expirations, consistent with the overview card (0–7 days)
    if (expiresSoonFilter) {
      result = result.filter(item => {
        const days = getDaysUntilExpiration(item.expirationDate);
        return days >= 0 && days <= 7;
      });
    }

    if (expiredFilter) result = result.filter(item => getDaysUntilExpiration(item.expirationDate) < 0);
    if (appFilter) result = result.filter(item => appNameKey(formatAppName(item.app || '', settings.appNames)) === appNameKey(formatAppName(appFilter, settings.appNames)));

    if (unpaidFilter) {
      result = result.filter(item => !item.isPaid);
    }

    // Date range filter
    if (filterStartDate) {
      const start = new Date(filterStartDate);
      if (isValid(start)) {
        start.setHours(0, 0, 0, 0);
        result = result.filter(item => {
          if (!item.expirationDate || item.expirationDate === 'NaT') return false;
          const exp = parseAnyDate(item.expirationDate);
          return exp && exp >= start;
        });
      }
    }
    
    if (filterEndDate) {
      const end = new Date(filterEndDate);
      if (isValid(end)) {
        end.setHours(23, 59, 59, 999);
        result = result.filter(item => {
          if (!item.expirationDate || item.expirationDate === 'NaT') return false;
          const exp = parseAnyDate(item.expirationDate);
          return exp && exp <= end;
        });
      }
    }

    // Default sorting by expiration date (ascending)
    result.sort((a, b) => {
      if (sortBy === 'name') return (a.name || '').localeCompare(b.name || '', 'hr');
      if (sortBy === 'newest') return (b.createdAt || 0) - (a.createdAt || 0);
      const da = parseAnyDate(a.expirationDate || '');
      const db = parseAnyDate(b.expirationDate || '');
      if (da && db) return da.getTime() - db.getTime();
      return da ? -1 : db ? 1 : 0;
    });

    return result;
  }, [data, search, expiresSoonFilter, filterStartDate, filterEndDate, showArchived, unpaidFilter, expiredFilter, appFilter, sortBy, settings.appNames]);

  const groupedData = useMemo(() => {
    const map = new Map<string, {
      name: string;
      contact: string;
      phone?: string;
      email?: string;
      tags?: string[];
      subscriptions: Subscription[];
    }>();

    processedData.forEach(sub => {
      const key = `${sub.name?.trim().toLowerCase()}_${sub.contact?.trim().toLowerCase()}`;
      if (!map.has(key)) {
        map.set(key, {
          name: sub.name || '',
          contact: sub.contact || '',
          phone: sub.phone,
          email: sub.email,
          tags: sub.tags,
          subscriptions: []
        });
      }
      map.get(key)!.subscriptions.push(sub);
    });

    return Array.from(map.values());
  }, [processedData]);

  const togglePaidStatus = async (id: string, currentStatus: boolean) => {
    await updateSubscription(id, { isPaid: !currentStatus });
  };

  const handleDelete = async () => {
    if (isDeleteModalOpen) {
      await deleteSubscription(isDeleteModalOpen);
      setDeleteModalOpen(null);
    }
  };

  const handleExtend = async (id: string, currentDateStr: string, packageId: string) => {
    let current = new Date();
    const parsed = parseAnyDate(currentDateStr);
    if (parsed) {
        current = parsed;
    }
    
    const pkg = settings.prices?.find(p => p.id === packageId);
    let monthsToAdd = 1;
    if (pkg) {
      monthsToAdd = pkg.months || 1;
    } else if (packageId === '1m') monthsToAdd = 1;
    else if (packageId === '3m') monthsToAdd = 3;
    else if (packageId === '6m') monthsToAdd = 6;
    else if (packageId === '1y') monthsToAdd = 12;

    let newDate = addMonths(current, monthsToAdd);
    
    const user = data.find(u => u.id === id);
    if (!user) return;

    const updates: Partial<Subscription> = { 
      expirationDate: format(newDate, 'yyyy-MM-dd'),
      isPaid: true 
    };

    if (pkg) {
      const newPayment = {
        id: Math.random().toString(36).substring(2, 11),
        date: Date.now(),
        amount: pkg.price,
        packageId: packageId
      };
      updates.payments = [...(user.payments || []), newPayment];
    }
    
    await updateSubscription(id, updates);
  };

  const handleBulkAction = async (action: 'extend' | 'paid' | 'archive' | 'delete', extendDuration?: string) => {
    if (selectedForNotification.size === 0) return;
    
    if (action === 'delete') {
      if (!window.confirm(`Jeste li sigurni da želite obrisati ${selectedForNotification.size} odabranih korisnika? Ovo se ne može poništiti.`)) return;
      for (const id of selectedForNotification) {
        await deleteSubscription(id);
      }
    } else if (action === 'archive') {
      if (!window.confirm(`Arhivirati ${selectedForNotification.size} odabranih korisnika?`)) return;
      for (const id of selectedForNotification) {
        await updateSubscription(id, { isArchived: true });
      }
    } else if (action === 'paid') {
      for (const id of selectedForNotification) {
        await updateSubscription(id, { isPaid: true });
      }
    } else if (action === 'extend' && extendDuration) {
      if (!window.confirm(`Produžiti pretplatu za ${selectedForNotification.size} korisnika?`)) return;
      for (const id of selectedForNotification) {
        const user = data.find(u => u.id === id);
        if (user) {
          await handleExtend(id, user.expirationDate, extendDuration);
        }
      }
    }
    
    setSelectedForNotification(new Set());
  };



  const toggleSelection = (id: string) => {
    const newSet = new Set(selectedForNotification);
    if (newSet.has(id)) newSet.delete(id);
    else newSet.add(id);
    setSelectedForNotification(newSet);
  };

  const handleLogout = async () => {
    await signOut(auth);
    router.push("/login");
  };

  const handleSharePrices = async () => {
    const url = window.location.origin + '/cjenik';
    if (navigator.share) {
      try {
        await navigator.share({
          title: 'Cjenik Pretplata',
          text: 'Pogledajte naše pakete i cijene:',
          url: url
        });
      } catch (err) {
        console.error('Error sharing:', err);
      }
    } else {
      navigator.clipboard.writeText(url);
      alert('Link na cjenik je kopiran! (' + url + ')');
    }
  };

  const activeData = data.filter(i => !i.isArchived);
  const stats = {
    totalActive: activeData.length,
    expiringSoon: activeData.filter(i => { const days = getDaysUntilExpiration(i.expirationDate); return days >= 0 && days <= 7; }).length,
    expired: activeData.filter(i => getDaysUntilExpiration(i.expirationDate) < 0).length,
    unpaid: activeData.filter(i => !i.isPaid).length,
    archived: data.filter(i => i.isArchived).length
  };

  const closeDetail = () => { detailDialog.current?.close(); setDetailId(null); };
  const openDetailAction = (action: () => void) => { closeDetail(); action(); };
  const resetFilters = () => {
    setSearch(''); setExpiresSoonFilter(false); setExpiredFilter(false);
    setUnpaidFilter(false); setFilterStartDate(''); setFilterEndDate(''); setAppFilter('');
  };
  const hasFilters = Boolean(search || expiresSoonFilter || expiredFilter || unpaidFilter || filterStartDate || filterEndDate || appFilter);

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  return (
    <div className="dashboard-shell min-h-screen p-4 md:p-8 max-w-[1600px] mx-auto">
      {/* Header Area */}
      <header className="dashboard-header flex flex-col gap-5 mb-8">
        <div className="flex items-center gap-4">
          <div>
            <h1 className="text-3xl font-semibold text-white tracking-tight leading-tight">
              Baza<span className="brand-badge">PRO</span>
            </h1>
            <p className="text-slate-400 text-sm mt-0.5">Sve pretplate, kontakti i naplata na jednom mjestu.</p>
          </div>
        </div>
        
        <div className="dashboard-actions flex gap-2 flex-wrap items-center">
          <button className="btn btn-primary" onClick={() => setNewModalOpen(true)}><Plus size={16}/> Dodaj korisnika</button>
          <button onClick={() => setNotifyModalOpen(true)} className="btn btn-ghost"><Bell size={16}/> Obavijesti {selectedForNotification.size > 0 && `(${selectedForNotification.size})`}</button>
          <button
            onClick={() => { resetFilters(); setSelectedForNotification(new Set()); setShowArchived(!showArchived); }}
            className="btn btn-ghost"
            aria-pressed={showArchived}
          >
            {showArchived ? <ArchiveRestore size={16}/> : <Archive size={16}/>}
            {showArchived ? 'Natrag na aktivne' : `Arhiva (${stats.archived})`}
          </button>
          <details className="tools-menu"><summary className="btn btn-ghost"><SettingsIcon size={16}/> Alati</summary><div className="tools-dropdown">
          <button onClick={() => setAIModalOpen(true)} className="btn btn-sm btn-ghost border border-slate-700 text-indigo-400 hover:text-indigo-300">
            <Bot size={16} />
            AI Asistent
          </button>
          <button onClick={() => setImportModalOpen(true)} className="btn btn-sm bg-slate-800 hover:bg-slate-700 text-slate-200">
            <Upload size={16} />
            Uvoz
          </button>
          <button onClick={exportToExcel} className="btn btn-sm bg-emerald-600/90 hover:bg-emerald-500 text-white">
            <Download size={16} />
            Izvoz
          </button>
          <button onClick={handleSharePrices} className="btn btn-sm bg-fuchsia-600/90 hover:bg-fuchsia-500 text-white">
            <Share size={16} />
            Podijeli Cjenik
          </button>
          <button onClick={() => setAnalyticsModalOpen(true)} className="btn btn-sm bg-blue-600/90 hover:bg-blue-500 text-white border border-blue-500">
            <TrendingUp size={16} />
            Analitika
          </button>
          <button onClick={() => setSettingsModalOpen(true)} className="btn btn-sm btn-ghost text-slate-300 hover:text-white" title="Postavke">
            <SettingsIcon size={18} /> Postavke
          </button>
          </div></details>
          <button onClick={handleLogout} className="btn btn-ghost sm:ml-auto" title="Odjava">
            <LogOut size={18} /> Odjava
          </button>
        </div>
      </header>

      {/* Main Content Area */}
      <div className="glass-panel p-3 md:p-4 mb-4">
        
        <div className="overview-heading"><div><span className="eyebrow">RADNI PROSTOR</span><h2>{showArchived ? 'Arhivirane pretplate' : 'Pregled pretplata'}</h2></div><span className="text-sm text-slate-400">Brzi pristup najvažnijem</span></div>
        <div className="stats-grid">
          {[
            { label: 'Aktivne pretplate', value: stats.totalActive, hint: 'Sve nearhivirane linije', active: !showArchived && !hasFilters, action: () => { resetFilters(); setShowArchived(false); }, tone: 'blue' },
            { label: 'Istječe u 7 dana', value: stats.expiringSoon, hint: 'Vrijeme za obnovu', active: expiresSoonFilter, action: () => { resetFilters(); setShowArchived(false); setExpiresSoonFilter(true); }, tone: 'amber' },
            { label: 'Istekle pretplate', value: stats.expired, hint: 'Potrebna provjera', active: expiredFilter, action: () => { resetFilters(); setShowArchived(false); setExpiredFilter(true); }, tone: 'red' },
            { label: 'Neplaćeno', value: stats.unpaid, hint: 'Otvorene obveze', active: unpaidFilter, action: () => { resetFilters(); setShowArchived(false); setUnpaidFilter(true); }, tone: 'red' },
            { label: 'Arhiva', value: stats.archived, hint: 'Spremljene pretplate', active: showArchived, action: () => { resetFilters(); setShowArchived(true); }, tone: 'blue' },
          ].map(card => <button key={card.label} onClick={card.action} aria-pressed={card.active} className={cn('stat-card', card.active && 'stat-card-active')} data-tone={card.tone}>
            <span>{card.label}</span><strong>{card.value}</strong><small>{card.hint}</small>
          </button>)}
        </div>

        {/* Search Bar and Date Filters */}
        <div className="flex flex-col lg:flex-row gap-3 mb-4">
          <div className="relative flex-1">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
            <input 
              type="text" 
              aria-label="Pretraži pretplate" placeholder="Pretraži ime, telefon, aplikaciju, MAC…" 
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-11 pr-10 py-3 glass-input text-base rounded-lg h-full"
            />
            {search && (
              <button 
                onClick={() => setSearch("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700 p-1 rounded-full transition-colors"
                title="Obriši pretragu"
              >
                <X size={16} />
              </button>
            )}
          </div>
          
          <div className="flex flex-wrap items-center gap-3 bg-slate-800/30 px-4 py-2 rounded-lg border border-slate-700/50">
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-400">Od:</span>
              <input 
                type="date" 
                value={filterStartDate}
                onChange={(e) => setFilterStartDate(e.target.value)}
                className="bg-transparent text-slate-200 text-sm outline-none border-b border-slate-600 focus:border-indigo-500 pb-0.5"
              />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-400">Do:</span>
              <input 
                type="date" 
                value={filterEndDate}
                onChange={(e) => setFilterEndDate(e.target.value)}
                className="bg-transparent text-slate-200 text-sm outline-none border-b border-slate-600 focus:border-indigo-500 pb-0.5"
              />
            </div>
            <div className="flex gap-1 ml-1">
              <button 
                onClick={() => {
                  const today = format(new Date(), 'yyyy-MM-dd');
                  setFilterStartDate(today);
                  setFilterEndDate(today);
                }}
                className="text-xs bg-indigo-600/20 text-indigo-300 hover:bg-indigo-600/40 border border-indigo-500/30 px-2 py-1 rounded transition-colors"
              >
                Danas
              </button>
              {(filterStartDate || filterEndDate) && (
                <button 
                  onClick={() => {
                    setFilterStartDate("");
                    setFilterEndDate("");
                  }}
                  className="text-xs text-slate-400 hover:text-white px-2 py-1 rounded transition-colors"
                >
                  <X size={14} />
                </button>
              )}
            </div>
          </div>
        </div>

        <div className="filter-toolbar">
          <div className="flex flex-wrap items-center gap-3">
            <label className="text-sm text-slate-400">Aplikacija <select aria-label="Filtriraj po aplikaciji" className="glass-input ml-2" value={appFilter} onChange={e => setAppFilter(e.target.value)}><option value="">Sve aplikacije</option>{sortedUniqueApps(data.map(item => item.app).filter(Boolean), settings.appNames).map(app => <option key={app} value={app}>{formatAppName(app, settings.appNames)}</option>)}</select></label>
            <label className="text-sm text-slate-400">Poredak <select className="glass-input ml-2" value={sortBy} onChange={e => setSortBy(e.target.value)}><option value="expiration">Najbliži istek</option><option value="name">Ime A–Ž</option><option value="newest">Najnovije dodano</option></select></label>
            {hasFilters && <button className="btn btn-ghost text-sm" onClick={resetFilters}><X size={14}/> Očisti filtre</button>}
          </div>
          <span role="status" className="text-sm text-slate-400">{processedData.length} pretplata{selectedForNotification.size > 0 && ` · ${selectedForNotification.size} odabrano`}</span>
        </div>
        {/* Table Container */}
        <div className="subscription-table overflow-x-auto rounded-xl border border-slate-800 bg-slate-900/50">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-800/80 text-slate-300 text-sm uppercase tracking-wider">
                <th className="py-3 px-3 font-semibold w-12 text-center">
                  <input type="checkbox" aria-label="Odaberi sve prikazane pretplate" checked={processedData.length > 0 && processedData.every(row => selectedForNotification.has(row.id))} onChange={(e) => {
                    if (e.target.checked) setSelectedForNotification(new Set(processedData.map(d => d.id)));
                    else setSelectedForNotification(new Set());
                  }} />
                </th>
                <th className="py-3 px-3 font-semibold">Ime i Prezime</th>
                <th className="py-3 px-3 font-semibold">Aplikacija</th>
                
                <th className="py-3 px-3 font-semibold">Istek</th>
                <th className="py-3 px-3 font-semibold text-center">Plaćeno</th>
                
                <th className="py-3 px-3 font-semibold text-right">Akcije</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/50 text-sm">
              {processedData.length === 0 ? (
                <tr><td colSpan={6} className="p-8 text-center text-slate-500">Nema pretplata za ovaj prikaz.{hasFilters && <button onClick={resetFilters} className="btn btn-ghost mx-auto mt-3">Očisti filtre</button>}</td></tr>
              ) : (
                processedData.map((row) => {
                  const daysLeft = getDaysUntilExpiration(row.expirationDate);
                  const isExpiringSoon = daysLeft <= 7 && daysLeft >= 0;
                  const isExpired = daysLeft < 0;
                  
                  return (
                    <tr 
                      key={row.id} 
                      className={cn(
                        "group border-b border-slate-800/50 hover:bg-slate-800/30 transition-colors",
                        isExpired ? "bg-red-950/10" : isExpiringSoon ? "bg-amber-950/10" : ""
                      )}
                    >
                      <td className="py-2 px-3 text-center">
                        <input 
                          type="checkbox" 
                          checked={selectedForNotification.has(row.id)}
                          onChange={() => toggleSelection(row.id)}
                          className="w-4 h-4 rounded border-slate-600 text-primary focus:ring-primary"
                        />
                      </td>
                      <td className="py-2 px-3 font-medium">
                        <div className="flex items-center gap-2">
                          <button className="text-left font-semibold hover:text-blue-300 underline-offset-4 hover:underline" onClick={() => setDetailId(row.id)}>{row.name || 'Bez imena'}</button>
                          {row.note && (
                            <button 
                              onClick={() => setNoteModalContent(row.note)} 
                              className="text-amber-400 hover:text-amber-300 transition-colors shrink-0" 
                              title="Prikaži napomenu"
                            >
                              <MessageSquare size={14} />
                            </button>
                          )}
                        </div>
                        {row.tags && row.tags.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-1">
                            {row.tags.map(t => (
                              <span key={t} className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800/80 text-indigo-300/80 border border-slate-700/50">#{t}</span>
                            ))}
                          </div>
                        )}
                      </td>
                      <td className="py-2 px-3">
                        <span className="px-1.5 py-0.5 bg-slate-800/80 rounded text-xs text-slate-300 border border-slate-700/50 whitespace-nowrap">{formatAppName(row.app || '', settings.appNames) || '-'}</span>
                      </td>
                      <td className="py-2 px-3">
                        <div className="flex items-center gap-1.5 whitespace-nowrap">
                          <span className={cn(
                            "font-bold text-sm px-2 py-1 rounded-md",
                            isExpired ? "bg-red-500/20 text-red-400 border border-red-500/30" : isExpiringSoon ? "bg-amber-500/20 text-amber-400 border border-amber-500/30" : "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                          )}>
                            {row.expirationDate ? (parseAnyDate(row.expirationDate) ? format(parseAnyDate(row.expirationDate)!, 'dd.MM.yyyy') : row.expirationDate) : '-'}
                          </span>
                          {(isExpiringSoon || isExpired) && (
                            <span className={cn("text-[10px] px-1.5 py-0.5 rounded font-bold uppercase tracking-wider", isExpired ? "bg-red-500/20 text-red-400" : "bg-amber-500/20 text-amber-400")}>
                              {isExpired ? "ISTEKLO" : `${Math.ceil(daysLeft)}d`}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="py-2 px-3 text-center">
                        <button 
                          onClick={() => togglePaidStatus(row.id, row.isPaid)}
                          className={cn(
                            "px-2 py-0.5 rounded text-[10px] font-bold transition-all shadow-sm whitespace-nowrap",
                            row.isPaid ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500/20" : "bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20"
                          )}
                        >
                          {row.isPaid ? 'PLAĆENO' : 'NEPLAĆENO'}
                        </button>
                      </td>
                      <td className="py-2 px-3 text-right">
                        <div className="flex items-center justify-end gap-3">
                          <select 
                            className="bg-slate-800/50 text-emerald-400 hover:text-emerald-300 text-sm font-medium border border-emerald-500/30 rounded-md px-2 py-1.5 outline-none cursor-pointer appearance-none text-center"
                            value=""
                            onChange={(e) => {
                              if (e.target.value) {
                                handleExtend(row.id, row.expirationDate, e.target.value as any);
                              }
                            }}
                          >
                            <option value="" disabled hidden>Produži ▾</option>
                            {settings.prices && settings.prices.length > 0 ? (
                              settings.prices.map(pkg => (
                                <option key={pkg.id} value={pkg.id} className="bg-slate-800 text-slate-200">
                                  {pkg.name} ({pkg.price}€)
                                </option>
                              ))
                            ) : (
                              <>
                                <option value="1m" className="bg-slate-800 text-slate-200">+ 1 Mjesec</option>
                                <option value="3m" className="bg-slate-800 text-slate-200">+ 3 Mjeseca</option>
                                <option value="6m" className="bg-slate-800 text-slate-200">+ 6 Mjeseci</option>
                                <option value="1y" className="bg-slate-800 text-slate-200">+ 1 Godina</option>
                              </>
                            )}
                          </select>
                          <button onClick={() => setDetailId(row.id)} className="btn btn-ghost text-xs">Detalji</button>
                        </div>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>



      <dialog ref={detailDialog} className="customer-drawer" onCancel={closeDetail} onClose={() => setDetailId(null)} aria-labelledby="customer-title">
        {detail && <>
          <div className="drawer-heading"><div><span className="eyebrow">DETALJI PRETPLATE</span><h2 id="customer-title">{detail.name || 'Bez imena'}</h2><p>{formatAppName(detail.app || '', settings.appNames) || 'Aplikacija nije unesena'}</p></div><button autoFocus onClick={closeDetail} className="btn btn-ghost" aria-label="Zatvori detalje"><X size={20}/></button></div>
          <div className="detail-section"><h3>Pretplata</h3><p>Istek: <strong>{parseAnyDate(detail.expirationDate) ? format(parseAnyDate(detail.expirationDate)!, 'dd.MM.yyyy') : 'Nije unesen'}</strong></p><p>{detail.isPaid ? 'Plaćeno' : 'Nije plaćeno'} · {detail.isArchived ? 'Arhivirano' : 'Aktivna evidencija'}</p></div>
          <div className="detail-section"><h3>Uređaj</h3><dl><dt>MAC adresa</dt><dd>{detail.macAddress || 'Nije unesena'}</dd><dt>Device key</dt><dd>{detail.deviceKey || 'Nije unesen'}</dd></dl></div>
          <h3 className="px-1 font-semibold">Kontakt</h3>
                      <div className="detail-section">
                        <div className="flex items-center gap-2">
                          <ContactIcon contact={detail.contact} />
                          <div className="flex flex-col gap-0.5">
                            {detail.phone && detail.phone.split(/,|:::|\//).map(p => p.trim()).filter(Boolean).map((phoneNum, idx) => (
                              <a 
                                key={idx}
                                href={generateMessageLink(phoneNum, (settings.quickMessageTemplate || "Poštovani {ime}, podsjećamo vas na vašu pretplatu.").replace(/{ime}/gi, detail.name).replace(/{datum}/gi, detail.expirationDate || ''), detail.contact)}
                                onClick={() => navigator.clipboard.writeText((settings.quickMessageTemplate || "Poštovani {ime}, podsjećamo vas na vašu pretplatu.").replace(/{ime}/gi, detail.name).replace(/{datum}/gi, detail.expirationDate || '')).catch(() => {})}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-emerald-400 hover:text-emerald-300 transition-colors flex items-center gap-1 bg-emerald-500/10 px-1.5 py-0.5 rounded-sm w-fit mt-0.5"
                                title="Pošalji WhatsApp poruku"
                              >
                                <MessageSquare size={12} />
                                <span className="font-medium">{phoneNum}</span>
                              </a>
                            ))}
                            {detail.email && <div className="text-slate-400 truncate max-w-[130px]">{detail.email}</div>}
                          </div>
                        </div>
                      </div>

          <div className="detail-section"><h3>Napomene</h3><p className="whitespace-pre-wrap">{detail.note || 'Nema napomena.'}</p></div>
          <div className="detail-section"><h3>Povijest uplata</h3>{detail.payments?.length ? <ul className="space-y-3">{[...detail.payments].sort((a,b) => b.date-a.date).map(payment => <li key={payment.id} className="flex justify-between"><span>{format(new Date(payment.date), 'dd.MM.yyyy')}</span><strong>{payment.amount.toLocaleString('hr-HR', {style:'currency', currency:'EUR'})}</strong></li>)}</ul> : <p>Nema zabilježenih uplata.</p>}</div>
          <div className="drawer-actions">
                          <button onClick={() => updateSubscription(detail.id, { isArchived: !detail.isArchived })} className="text-indigo-400 hover:text-indigo-300 transition-colors p-1" title={detail.isArchived ? "Vrati iz arhive" : "Arhiviraj korisnika"}>
                            {detail.isArchived ? <ArchiveRestore size={18} /> : <Archive size={18} />}
                            {detail.isArchived ? 'Vrati iz arhive' : 'Arhiviraj'}
                          </button>
                          
                          <button onClick={() => openDetailAction(() => setNewModalOpen({ name: detail.name, contact: detail.contact, phone: detail.phone || '', email: detail.email || '', tags: detail.tags }))} className="text-emerald-400 hover:text-emerald-300 transition-colors p-1" title="Dodaj uređaj ovom korisniku">
                            <Plus size={18} /> Dodaj uređaj
                          </button>
                          <button onClick={() => openDetailAction(() => setEditModalOpen(detail))} className="text-blue-400 hover:text-blue-300 transition-colors p-1" title="Uredi">
                            <Edit size={18} /> Uredi
                          </button>
                          <button onClick={() => openDetailAction(() => setDeleteModalOpen(detail.id))} className="text-red-400 hover:text-red-300 transition-colors p-1" title="Obriši">
                            <Trash2 size={18} /> Obriši
                          </button>

          </div>
        </>}
      </dialog>

      {/* Delete Confirmation Modal */}
      {isDeleteModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="glass-panel p-8 max-w-md w-full border-red-500/30 animate-in zoom-in-95 duration-200">
            <div className="flex items-center gap-4 text-red-400 mb-4">
              <AlertCircle size={32} />
              <h2 className="text-xl font-bold">Zabrana slučajnog brisanja</h2>
            </div>
            <p className="text-slate-300 mb-8">
              Jeste li potpuno sigurni da želite trajno obrisati ovu pretplatničku liniju? 
              Ova akcija se ne može poništiti.
            </p>
            <div className="flex justify-end gap-4">
              <button onClick={() => setDeleteModalOpen(null)} className="btn btn-ghost">Odustani</button>
              <button onClick={handleDelete} className="btn btn-danger">Potvrdi Brisanje</button>
            </div>
          </div>
        </div>
      )}

      {/* Note Display Modal */}
      {noteModalContent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="glass-panel p-6 max-w-md w-full animate-in zoom-in-95 duration-200">
            <h3 className="text-lg font-bold text-amber-400 mb-4 flex items-center gap-2">
              <MessageSquare size={20} />
              Napomena
            </h3>
            <div className="bg-slate-800/50 p-4 rounded-lg text-slate-300 whitespace-pre-wrap max-h-64 overflow-y-auto">
              {noteModalContent}
            </div>
            <div className="flex justify-end mt-6">
              <button onClick={() => setNoteModalContent(null)} className="btn btn-ghost">Zatvori</button>
            </div>
          </div>
        </div>
      )}

      {/* Edit/New Modal Component */}
      {(isEditModalOpen || isNewModalOpen) && (
        <EditModal 
          subscription={isEditModalOpen} 
          presetData={typeof isNewModalOpen === 'object' ? isNewModalOpen : undefined}
          settings={settings}
          onClose={() => { setEditModalOpen(null); setNewModalOpen(false); }} 
        />
      )}

      {/* Settings Modal */}
      {isSettingsModalOpen && (
        <SettingsModal 
          data={data}
          settings={settings} 
          onClose={() => setSettingsModalOpen(false)} 
          onOpenManualSync={() => {
            setSettingsModalOpen(false);
            setManualSyncModalOpen(true);
          }}
        />
      )}

      {isAnalyticsModalOpen && (
        <AnalyticsModal 
          data={data}
          onClose={() => setAnalyticsModalOpen(false)}
        />
      )}

      {isManualSyncModalOpen && (
        <ManualContactSyncModal
          subscriptions={data}
          onClose={() => setManualSyncModalOpen(false)}
        />
      )}
      
      {/* Notifications */}
      {isNotifyModalOpen && (
        <NotifyControlCenterModal 
          selectedIds={Array.from(selectedForNotification)} 
          data={processedData} 
          apiKey={settings.geminiApiKey || ''}
          onClose={() => setNotifyModalOpen(false)} 
        />
      )}

      {/* Import Modal */}
      {isImportModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 overflow-y-auto">
          <div className="glass-panel p-8 max-w-4xl w-full animate-in zoom-in-95 duration-200 my-8">
            <div className="flex items-center gap-4 text-indigo-400 mb-6">
              <Upload size={32} />
              <h2 className="text-xl font-bold">Pametni Uvoz iz Excela</h2>
            </div>
            
            {!importPreviewData ? (
              <>
                <div 
                  className="border-2 border-dashed border-slate-600 rounded-xl p-12 flex flex-col items-center justify-center text-center cursor-pointer hover:border-indigo-500 hover:bg-indigo-500/10 transition-colors"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Upload size={48} className="text-slate-400 mb-4" />
                  <p className="text-slate-300 font-medium text-lg">Kliknite za odabir .xlsm ili .xlsx datoteke</p>
                  <p className="text-slate-500 text-sm mt-2">Aplikacija će skenirati podatke i pripremiti izvještaj prije uvoza</p>
                  <input type="file" accept=".xlsx, .xls, .xlsm" className="hidden" ref={fileInputRef} onChange={handleFileUpload} />
                </div>
                <div className="flex justify-end gap-4 mt-8">
                  <button onClick={() => setImportModalOpen(false)} className="btn btn-ghost">Zatvori</button>
                </div>
              </>
            ) : (
              <div className="flex flex-col max-h-[70vh]">
                <div className="mb-4 flex gap-4 text-sm font-medium">
                  <div className="bg-emerald-500/20 text-emerald-400 px-3 py-1 rounded-full">Novi korisnici: {importPreviewData.filter(i => i.action === 'NEW').length}</div>
                  <div className="bg-amber-500/20 text-amber-400 px-3 py-1 rounded-full">Ažurirani: {importPreviewData.filter(i => i.action === 'UPDATE').length}</div>
                  <div className="bg-slate-500/20 text-slate-400 px-3 py-1 rounded-full">Nepromijenjeni: {importPreviewData.filter(i => i.action === 'UNCHANGED').length}</div>
                </div>
                
                <div className="overflow-y-auto flex-1 bg-slate-900/50 rounded-xl border border-slate-800 p-4 space-y-4">
                  {importPreviewData.filter(i => i.action !== 'UNCHANGED').length === 0 ? (
                    <div className="text-center text-slate-400 py-8">Nema novih promjena za uvoz. Baza je već usklađena s Excelom.</div>
                  ) : (
                    importPreviewData.map((item, idx) => {
                      if (item.action === 'UNCHANGED') return null;
                      return (
                      <div 
                        key={idx} 
                        className={cn(
                          "p-4 rounded-lg border flex gap-4 transition-colors cursor-pointer", 
                          item.selected ? "border-indigo-500/50 bg-indigo-500/10" : "border-slate-700/50 bg-slate-800/50 hover:border-slate-600"
                        )} 
                        onClick={() => toggleSyncItemSelection(idx)}
                      >
                        <div className="pt-1 flex-shrink-0">
                          <input 
                            type="checkbox" 
                            className="w-5 h-5 rounded border-slate-600 text-indigo-500 focus:ring-indigo-500 cursor-pointer pointer-events-none" 
                            checked={!!item.selected} 
                            readOnly 
                          />
                        </div>
                        <div className="flex-1">
                          {item.action === 'NEW' ? (
                            <div>
                              <span className="text-xs font-bold bg-emerald-500 text-white px-2 py-0.5 rounded uppercase mr-2">NOVI KORISNIK</span>
                              <span className="font-medium text-slate-200">{item.updated.name}</span>
                              <div className="text-sm text-slate-400 mt-2">
                                MAC: {item.updated.macAddress || '-'} | Aplikacija: {formatAppName(item.updated.app || '', settings.appNames) || '-'} | Istek: {item.updated.expirationDate || '-'}
                              </div>
                            </div>
                          ) : (
                            <div>
                              <span className="text-xs font-bold bg-amber-500 text-white px-2 py-0.5 rounded uppercase mr-2">AŽURIRANJE</span>
                              <span className="font-medium text-slate-200">{item.original?.name}</span>
                              <ul className="mt-2 text-sm text-amber-200/80 list-disc list-inside space-y-1">
                                {item.changes?.map((c, i) => <li key={i}>{c}</li>)}
                              </ul>
                            </div>
                          )}
                        </div>
                      </div>
                    )})
                  )}
                </div>
                
                <div className="flex justify-end gap-4 mt-6 pt-4 border-t border-slate-800">
                  <button onClick={() => setImportPreviewData(null)} className="btn btn-ghost" disabled={isSyncing}>Odustani</button>
                  <button 
                    onClick={handleConfirmSync} 
                    disabled={isSyncing || importPreviewData.filter(i => i.action !== 'UNCHANGED').length === 0} 
                    className="btn btn-primary"
                  >
                    {isSyncing ? "Spremanje u tijeku..." : "Potvrdi i Spremi u Bazu"}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Bulk Actions Floating Bar */}
      {selectedForNotification.size > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 animate-in slide-in-from-bottom-10 fade-in duration-300">
          <div className="glass-panel py-3 px-6 rounded-full shadow-2xl shadow-indigo-500/20 flex items-center gap-4 border border-indigo-500/30">
            <span className="bg-indigo-500 text-white font-bold w-8 h-8 rounded-full flex items-center justify-center text-sm shadow-inner shadow-white/20">
              {selectedForNotification.size}
            </span>
            <span className="text-slate-200 font-medium whitespace-nowrap">Odabranih</span>
            <div className="w-px h-6 bg-slate-700/50 mx-2"></div>
            
            <button 
              onClick={() => handleBulkAction('paid')} 
              className="text-emerald-400 hover:text-emerald-300 transition-colors whitespace-nowrap text-sm font-medium flex items-center gap-1.5"
            >
              <Check size={16} /> Plaćeno svima
            </button>
            
            <select 
              className="bg-transparent text-indigo-400 hover:text-indigo-300 text-sm font-medium outline-none cursor-pointer border-none"
              value=""
              onChange={(e) => handleBulkAction('extend', e.target.value as any)}
            >
              <option value="" disabled hidden>Produži svima ▾</option>
              {settings.prices && settings.prices.length > 0 ? (
                settings.prices.map(pkg => (
                  <option key={pkg.id} value={pkg.id} className="bg-slate-800 text-slate-200">
                    {pkg.name} ({pkg.price}€)
                  </option>
                ))
              ) : (
                <>
                  <option value="1m" className="bg-slate-800 text-slate-200">+ 1 Mjesec</option>
                  <option value="3m" className="bg-slate-800 text-slate-200">+ 3 Mjeseca</option>
                  <option value="6m" className="bg-slate-800 text-slate-200">+ 6 Mjeseci</option>
                  <option value="1y" className="bg-slate-800 text-slate-200">+ 1 Godina</option>
                </>
              )}
            </select>
            
            <button 
              onClick={() => handleBulkAction('archive')} 
              className="text-slate-400 hover:text-slate-300 transition-colors whitespace-nowrap text-sm font-medium flex items-center gap-1.5"
            >
              <Archive size={16} /> Arhiviraj
            </button>
            
            <button 
              onClick={() => handleBulkAction('delete')} 
              className="text-red-400 hover:text-red-300 transition-colors whitespace-nowrap text-sm font-medium flex items-center gap-1.5"
            >
              <Trash2 size={16} /> Obriši
            </button>

            <button 
              onClick={() => setSelectedForNotification(new Set())}
              className="ml-2 text-slate-500 hover:text-slate-300 bg-slate-800/50 hover:bg-slate-800 rounded-full p-1.5 transition-colors"
            >
              <X size={16} />
            </button>
          </div>
        </div>
      )}

      {/* AI Assistant */}
      {isAIModalOpen && (
        <AIModal 
          data={data} 
          apiKey={settings.geminiApiKey || ''} 
          onClose={() => setAIModalOpen(false)}
          setSearch={setSearch}
          updateSubscription={updateSubscription}
          addSubscription={addSubscription}
          deleteSubscription={deleteSubscription}
        />
      )}

      {/* Floating Scroll Buttons */}
      <div className="fixed bottom-6 right-6 flex flex-col gap-3 z-40">
        <button 
          onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
          className="bg-indigo-600/80 hover:bg-indigo-500 text-white p-3 rounded-full shadow-lg backdrop-blur-sm border border-indigo-500/30 transition-all hover:scale-110"
          title="Skrolaj na vrh"
        >
          <ArrowUp size={24} />
        </button>
        <button 
          onClick={() => window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' })}
          className="bg-indigo-600/80 hover:bg-indigo-500 text-white p-3 rounded-full shadow-lg backdrop-blur-sm border border-indigo-500/30 transition-all hover:scale-110"
          title="Skrolaj na dno"
        >
          <ArrowDown size={24} />
        </button>
      </div>
    </div>
  );
}

// Subcomponent for Edit/New Modal
function EditModal({ subscription, settings, onClose, presetData }: { subscription: Subscription | null, settings: AppSettings, onClose: () => void, presetData?: Partial<Subscription> }) {
  const isNew = !subscription;
  const [activeTab, setActiveTab] = useState<'edit' | 'log'>('edit');
  const [formData, setFormData] = useState<Partial<Subscription>>(subscription || presetData || {
    name: '', app: '', contact: '', macAddress: '', deviceKey: '', expirationDate: '', isPaid: false, email: '', phone: '', note: ''
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isNew) {
      await addSubscription(formData as any);
    } else {
      await updateSubscription(subscription!.id, formData);
    }
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 overflow-hidden">
      <div className="glass-panel p-4 md:p-6 max-w-2xl w-full max-h-[95vh] overflow-y-auto">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-2xl font-bold text-white">{isNew ? 'Nova Pretplatnička Linija' : 'Uređivanje Linije'}</h2>
          {!isNew && (
            <div className="flex bg-slate-800 rounded-lg p-1">
              <button 
                type="button"
                className={cn("px-4 py-1.5 rounded-md text-sm font-medium transition-colors", activeTab === 'edit' ? "bg-indigo-500 text-white" : "text-slate-400 hover:text-white")}
                onClick={() => setActiveTab('edit')}
              >
                Detalji
              </button>
              <button 
                type="button"
                className={cn("px-4 py-1.5 rounded-md text-sm font-medium transition-colors", activeTab === 'log' ? "bg-indigo-500 text-white" : "text-slate-400 hover:text-white")}
                onClick={() => setActiveTab('log')}
              >
                Dnevnik
              </button>
            </div>
          )}
        </div>
        
        {activeTab === 'edit' && (
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-slate-400 mb-1">Ime i Prezime</label>
              <input required type="text" className="w-full glass-input" value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} />
            </div>
            <div>
              <label className="block text-sm text-slate-400 mb-1">Aplikacija</label>
              <select className="w-full glass-input" value={formData.app} onChange={e => setFormData({...formData, app: e.target.value})}>
                <option value="">Odaberi aplikaciju</option>
                {sortedUniqueApps([formData.app || '', ...settings.apps], settings.appNames).map(a => <option key={a} value={a}>{formatAppName(a, settings.appNames)}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm text-slate-400 mb-1">Kontakt Metoda</label>
              <select className="w-full glass-input" value={formData.contact} onChange={e => setFormData({...formData, contact: e.target.value})}>
                <option value="">Odaberi kontakt metodu</option>
                {settings.contacts.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm text-slate-400 mb-1">Datum Isteka</label>
              <input type="date" className="w-full glass-input" value={formData.expirationDate ? formData.expirationDate.split(' ')[0] : ''} onChange={e => setFormData({...formData, expirationDate: e.target.value})} />
            </div>
            <div>
              <label className="block text-sm text-slate-400 mb-1">MAC Adresa</label>
              <input type="text" className="w-full glass-input" value={formData.macAddress} onChange={e => setFormData({...formData, macAddress: e.target.value})} />
            </div>
            <div>
              <label className="block text-sm text-slate-400 mb-1">Device Key (opcionalno)</label>
              <input type="text" className="w-full glass-input" value={formData.deviceKey} onChange={e => setFormData({...formData, deviceKey: e.target.value})} />
            </div>
            <div>
              <label className="block text-sm text-slate-400 mb-1">Email</label>
              <input type="email" className="w-full glass-input" value={formData.email} onChange={e => setFormData({...formData, email: e.target.value})} />
            </div>
            <div>
              <label className="block text-sm text-slate-400 mb-1">Telefon <span className="text-[10px] text-slate-500">(za više brojeva koristite zarez)</span></label>
              <input type="text" className="w-full glass-input" value={formData.phone} onChange={e => setFormData({...formData, phone: e.target.value})} />
            </div>
          </div>

          <div className="mt-4">
            <label className="block text-sm text-slate-400 mb-1">Napomena (skriveno od glavne pretrage, opcionalno)</label>
            <textarea 
              className="w-full glass-input h-24 p-3" 
              placeholder="Unesite posebne napomene za ovog korisnika..."
              value={formData.note || ''} 
              onChange={e => setFormData({...formData, note: e.target.value})}
            />
          </div>
          
          {settings.availableTags && settings.availableTags.length > 0 && (
            <div className="mt-4">
              <label className="block text-sm text-slate-400 mb-2">Oznake (Tags)</label>
              <div className="flex flex-wrap gap-2">
                {settings.availableTags.map(tag => {
                  const isSelected = (formData.tags || []).includes(tag);
                  return (
                    <button
                      key={tag}
                      type="button"
                      onClick={() => {
                        const currentTags = formData.tags || [];
                        if (isSelected) {
                          setFormData({ ...formData, tags: currentTags.filter(t => t !== tag) });
                        } else {
                          setFormData({ ...formData, tags: [...currentTags, tag] });
                        }
                      }}
                      className={cn(
                        "px-3 py-1 rounded-full text-xs font-medium border transition-colors",
                        isSelected 
                          ? "bg-indigo-500/20 text-indigo-300 border-indigo-500/50" 
                          : "bg-slate-800/50 text-slate-400 border-slate-700 hover:bg-slate-700 hover:text-slate-300"
                      )}
                    >
                      #{tag}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div className="flex items-center gap-3 mt-4 p-4 bg-slate-800/50 rounded-lg">
            <input type="checkbox" id="isPaid" className="w-5 h-5 rounded border-slate-600 text-emerald-500 focus:ring-emerald-500" checked={formData.isPaid} onChange={e => setFormData({...formData, isPaid: e.target.checked})} />
            <label htmlFor="isPaid" className="text-slate-300 font-medium cursor-pointer">Pretplata je plaćena</label>
          </div>

          <div className="flex justify-end gap-4 mt-8 pt-4 border-t border-slate-800">
            <button type="button" onClick={onClose} className="btn btn-ghost">Odustani</button>
            <button type="submit" className="btn btn-primary">Spremi</button>
          </div>
        </form>
        )}

        {activeTab === 'log' && subscription && (
          <div className="space-y-6">
            <div>
              <h3 className="text-lg font-semibold text-slate-200 mb-3 border-b border-slate-800 pb-2">Uplate</h3>
              {(!subscription.payments || subscription.payments.length === 0) ? (
                <p className="text-sm text-slate-500 italic">Nema zabilježenih uplata.</p>
              ) : (
                <div className="space-y-2">
                  {subscription.payments.map((p, i) => (
                    <div key={i} className="flex justify-between items-center bg-slate-900/50 p-3 rounded-lg border border-slate-800/50">
                      <div>
                        <div className="text-slate-200 font-medium">{p.amount} EUR</div>
                        <div className="text-xs text-slate-400">Paket: {p.packageId}</div>
                      </div>
                      <div className="text-xs text-slate-500">
                        {format(new Date(p.date), 'dd.MM.yyyy. HH:mm')}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div>
              <h3 className="text-lg font-semibold text-slate-200 mb-3 border-b border-slate-800 pb-2">Aktivnosti</h3>
              {(!subscription.logs || subscription.logs.length === 0) ? (
                <p className="text-sm text-slate-500 italic">Nema zabilježenih aktivnosti.</p>
              ) : (
                <div className="space-y-2">
                  {subscription.logs.map((l, i) => (
                    <div key={i} className="bg-slate-900/50 p-3 rounded-lg border border-slate-800/50">
                      <div className="text-slate-300 text-sm mb-1">{l.text}</div>
                      <div className="text-xs text-slate-500">
                        {format(new Date(l.date), 'dd.MM.yyyy. HH:mm')}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            
            <div className="flex justify-end gap-4 mt-8 pt-4 border-t border-slate-800">
              <button type="button" onClick={onClose} className="btn bg-slate-800 hover:bg-slate-700 text-white">Zatvori</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function AnalyticsModal({ data, onClose }: { data: Subscription[], onClose: () => void }) {
  const [activeTab, setActiveTab] = useState<'revenue' | 'users'>('revenue');

  const now = new Date();
  const currentMonthStart = startOfMonth(now);
  const currentMonthEnd = endOfMonth(now);
  const lastMonthStart = startOfMonth(subMonths(now, 1));
  const lastMonthEnd = endOfMonth(subMonths(now, 1));

  // Calculate Revenue
  let currentMonthRevenue = 0;
  let lastMonthRevenue = 0;

  data.forEach(sub => {
    if (sub.payments) {
      sub.payments.forEach(payment => {
        const paymentDate = new Date(payment.date);
        if (isWithinInterval(paymentDate, { start: currentMonthStart, end: currentMonthEnd })) {
          currentMonthRevenue += payment.amount;
        } else if (isWithinInterval(paymentDate, { start: lastMonthStart, end: lastMonthEnd })) {
          lastMonthRevenue += payment.amount;
        }
      });
    }
  });

  const revenueGrowth = lastMonthRevenue > 0 
    ? ((currentMonthRevenue - lastMonthRevenue) / lastMonthRevenue) * 100 
    : 100;

  // Calculate Users
  const activeUsers = data.filter(s => !s.isArchived).length;
  const expiredUsers = data.filter(s => !s.isArchived && !s.isPaid).length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 overflow-y-auto">
      <div className="glass-panel p-6 max-w-2xl w-full my-8">
        <div className="flex justify-between items-center mb-6">
          <div className="flex items-center gap-3 text-white">
            <TrendingUp size={28} className="text-blue-400" />
            <h2 className="text-2xl font-bold">Financijska Analitika</h2>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white">
            <X size={24} />
          </button>
        </div>

        <div className="flex gap-4 border-b border-slate-700/50 mb-6 pb-2">
          <button onClick={() => setActiveTab('revenue')} className={cn("px-4 py-2 font-medium transition-colors", activeTab === 'revenue' ? "text-emerald-400 border-b-2 border-emerald-400" : "text-slate-400 hover:text-slate-300")}>Prihodi</button>
          <button onClick={() => setActiveTab('users')} className={cn("px-4 py-2 font-medium transition-colors", activeTab === 'users' ? "text-blue-400 border-b-2 border-blue-400" : "text-slate-400 hover:text-slate-300")}>Korisnici</button>
        </div>

        {activeTab === 'revenue' && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-slate-900/50 rounded-xl p-6 border border-slate-800">
              <h3 className="text-sm font-medium text-slate-400 mb-1">Ovaj Mjesec</h3>
              <div className="text-4xl font-bold text-white mb-2">{currentMonthRevenue.toFixed(2)} €</div>
              <div className={cn("text-sm font-medium flex items-center gap-1", revenueGrowth >= 0 ? "text-emerald-400" : "text-red-400")}>
                {revenueGrowth >= 0 ? <ArrowUp size={16} /> : <ArrowDown size={16} />}
                {Math.abs(revenueGrowth).toFixed(1)}% u odnosu na prošli
              </div>
            </div>
            
            <div className="bg-slate-900/50 rounded-xl p-6 border border-slate-800">
              <h3 className="text-sm font-medium text-slate-400 mb-1">Prošli Mjesec</h3>
              <div className="text-4xl font-bold text-slate-300">{lastMonthRevenue.toFixed(2)} €</div>
            </div>
          </div>
        )}

        {activeTab === 'users' && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-slate-900/50 rounded-xl p-6 border border-slate-800">
              <h3 className="text-sm font-medium text-slate-400 mb-1">Aktivni Korisnici</h3>
              <div className="text-4xl font-bold text-blue-400">{activeUsers}</div>
            </div>
            <div className="bg-slate-900/50 rounded-xl p-6 border border-slate-800">
              <h3 className="text-sm font-medium text-slate-400 mb-1">Isteklo (Neplaćeno)</h3>
              <div className="text-4xl font-bold text-red-400">{expiredUsers}</div>
            </div>
          </div>
        )}

        <div className="mt-8 pt-4 border-t border-slate-800 text-right">
          <button onClick={onClose} className="btn bg-slate-800 hover:bg-slate-700 text-white">Zatvori</button>
        </div>
      </div>
    </div>
  );
}

// Settings Modal Component
function SettingsModal({ data, settings, onClose, onOpenManualSync }: { data: Subscription[], settings: AppSettings, onClose: () => void, onOpenManualSync: () => void }) {
  const [apps, setApps] = useState<string[]>(settings.apps || []);
  const [newApp, setNewApp] = useState("");
  const [appError, setAppError] = useState("");
  const [appNames, setAppNames] = useState<Record<string, string>>(settings.appNames || {});
  const [editingApp, setEditingApp] = useState<string | null>(null);
  const [editedAppName, setEditedAppName] = useState("");
  const visibleApps = sortedUniqueApps(apps, appNames);
  const duplicateAppCount = apps.filter(app => appNameKey(app)).length - visibleApps.length;
  const [contacts, setContacts] = useState<string[]>(settings.contacts || []);
  const [newContact, setNewContact] = useState("");
  const [geminiApiKey, setGeminiApiKey] = useState(settings.geminiApiKey || "");
  const [prices, setPrices] = useState(settings.prices || []);
  const [templates, setTemplates] = useState(settings.messageTemplates || []);
  const [tags, setTags] = useState(settings.availableTags || []);
  const [newTag, setNewTag] = useState("");
  const [quickMessageTemplate, setQuickMessageTemplate] = useState(settings.quickMessageTemplate || "Poštovani {ime}, podsjećamo vas na vašu pretplatu.");
  const [cjenikTitle, setCjenikTitle] = useState(settings.cjenikTitle || "Odaberite Svoj Paket");
  const [cjenikSubtitle, setCjenikSubtitle] = useState(settings.cjenikSubtitle || "Uživajte u tisućama kanala, najnovijim filmovima i serijama u 4K rezoluciji. Bez ugovorne obveze, otkažite bilo kada.");
  const [cjenikNotes, setCjenikNotes] = useState((settings.cjenikNotes && settings.cjenikNotes.length > 0) ? settings.cjenikNotes : [
    "Svi paketi dolaze bez ugovorne obveze (prepaid sistem).",
    "Gledanje na 2 uređaja istovremeno je moguće samo za različite IP adrese (ako nije drugačije navedeno).",
    "Preporučena minimalna brzina interneta je 20 Mbps za 4K sadržaj.",
    "Prihvaćamo razne načine plaćanja (PayPal, Kriptovalute, Bankovni prijenos)."
  ]);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<'general' | 'prices' | 'messages' | 'tags'>('general');

  const handleSave = async () => {
    if (editingApp !== null) {
      setAppError('Najprije potvrdi izmijenjeni naziv ili odustani od uređivanja.');
      return;
    }
    setSaving(true);
    try {
      await updateSettings({
        apps: sortedUniqueApps(apps, appNames), appNames, contacts, geminiApiKey, prices, availableTags: tags, messageTemplates: templates,
        cjenikTitle, cjenikSubtitle, cjenikNotes, quickMessageTemplate
      });
      onClose();
    } catch (error) {
      console.error('Spremanje postavki nije uspjelo', error);
      setAppError('Postavke nisu spremljene. Pokušaj ponovno.');
    } finally {
      setSaving(false);
    }
  };

  const confirmAppName = () => {
    if (editingApp === null) return;
    const name = formatAppName(editedAppName);
    if (!name) {
      setAppError('Unesi naziv aplikacije.');
      return;
    }
    if (apps.some(app => appNameKey(app) !== appNameKey(editingApp) &&
      appNameKey(formatAppName(app, appNames)) === appNameKey(name))) {
      setAppError(`Aplikacija ${name} već postoji na popisu.`);
      return;
    }
    // Rename the label only; subscriptions keep their original app values.
    setAppNames({ ...appNames, [appNameKey(editingApp)]: name });
    setEditingApp(null);
    setAppError('');
  };

  const handleBackup = () => {
    const backupStr = JSON.stringify(data, null, 2);
    const blob = new Blob([backupStr], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `baza_korisnika_backup_${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleRestore = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!window.confirm("UPOZORENJE! Uvoz sigurnosne kopije će prebrisati ili ažurirati postojeće podatke. Želite li nastaviti?")) {
      e.target.value = '';
      return;
    }

    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const text = event.target?.result as string;
        const importedData = JSON.parse(text) as Subscription[];
        if (Array.isArray(importedData)) {
          setSaving(true);
          await batchImportSubscriptions(importedData);
          alert("Backup uspješno uvezen! Molimo osvježite stranicu ako se podaci ne prikažu odmah.");
          setSaving(false);
          onClose();
        } else {
          alert("Neispravan format datoteke.");
        }
      } catch (err) {
        console.error("Greška pri uvozu:", err);
        alert("Dogodila se greška pri čitanju datoteke. Provjerite radi li se o ispravnom JSON backupu.");
      }
    };
    reader.readAsText(file);
  };

  const addItem = (type: 'apps' | 'contacts' | 'tags') => {
    if (type === 'apps') {
      if (!newApp.trim()) return;
      if (apps.some(app => appNameKey(app) === appNameKey(newApp) || appNameKey(formatAppName(app, appNames)) === appNameKey(newApp))) {
        setAppError(`Aplikacija ${formatAppName(newApp)} već postoji na popisu.`);
        return;
      }
      setApps(sortedUniqueApps([...apps, formatAppName(newApp)], appNames));
      setNewApp("");
      setAppError("");
    } else if (type === 'contacts' && newContact.trim() && !contacts.includes(newContact.trim().toUpperCase())) {
      setContacts([...contacts, newContact.trim().toUpperCase()]);
      setNewContact("");
    } else if (type === 'tags' && newTag.trim() && !tags.includes(newTag.trim())) {
      setTags([...tags, newTag.trim()]);
      setNewTag("");
    }
  };

  const removeItem = (type: 'apps' | 'contacts' | 'tags', item: string) => {
    if (type === 'apps') {
      setApps(apps.filter(a => appNameKey(a) !== appNameKey(item)));
    } else if (type === 'contacts') {
      setContacts(contacts.filter(c => c !== item));
    } else if (type === 'tags') {
      setTags(tags.filter(t => t !== item));
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 overflow-hidden">
      <div className="glass-panel p-4 md:p-6 max-w-3xl w-full max-h-[95vh] overflow-y-auto">
        <div className="flex justify-between items-center mb-6">
          <div className="flex items-center gap-3 text-white">
            <SettingsIcon size={28} />
            <h2 className="text-2xl font-bold">Postavke Aplikacije</h2>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white">
            <X size={24} />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-4 border-b border-slate-700/50 mb-6 pb-2 overflow-x-auto">
          <button onClick={() => setActiveTab('general')} className={cn("px-4 py-2 font-medium transition-colors whitespace-nowrap", activeTab === 'general' ? "text-indigo-400 border-b-2 border-indigo-400" : "text-slate-400 hover:text-slate-300")}>Općenito</button>
          <button onClick={() => setActiveTab('prices')} className={cn("px-4 py-2 font-medium transition-colors whitespace-nowrap", activeTab === 'prices' ? "text-emerald-400 border-b-2 border-emerald-400" : "text-slate-400 hover:text-slate-300")}>Cjenik</button>
          <button onClick={() => setActiveTab('messages')} className={cn("px-4 py-2 font-medium transition-colors whitespace-nowrap", activeTab === 'messages' ? "text-blue-400 border-b-2 border-blue-400" : "text-slate-400 hover:text-slate-300")}>Poruke</button>
          <button onClick={() => setActiveTab('tags')} className={cn("px-4 py-2 font-medium transition-colors whitespace-nowrap", activeTab === 'tags' ? "text-amber-400 border-b-2 border-amber-400" : "text-slate-400 hover:text-slate-300")}>Oznake (Tags)</button>
        </div>

        {activeTab === 'general' && (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          {/* Apps Editor */}
          <div className="bg-slate-900/50 rounded-xl p-4 border border-slate-800">
            <h3 className="text-lg font-semibold text-slate-200 mb-2">Padajući izbornik: Aplikacije</h3>
            <p className="text-xs text-slate-400 mb-4">{visibleApps.length} aplikacija · Abecedni poredak</p>
            <p className="text-xs text-slate-400 mb-3">Nazive možeš urediti gumbom Uredi. Promjene se spremaju gumbom Spremi Postavke.</p>
            <div className="flex gap-2 mb-4">
              <input 
                type="text" 
                className="glass-input flex-1"
                placeholder="Unesi novu aplikaciju..." 
                aria-label="Naziv nove aplikacije"
                value={newApp}
                onChange={(e) => { setNewApp(e.target.value); setAppError(""); }}
                onKeyDown={(e) => e.key === 'Enter' && addItem('apps')}
              />
              <button aria-label="Dodaj aplikaciju" onClick={() => addItem('apps')} className="btn bg-indigo-600 hover:bg-indigo-500 text-white px-3"><Plus size={20}/></button>
            </div>
            {appError && <p role="alert" className="text-sm text-amber-400 mb-3">{appError}</p>}
            <p className="text-xs text-slate-400 mb-3">{duplicateAppCount > 0 ? `Pronađeno ponavljanja: ${duplicateAppCount}. Na popisu se svaki naziv prikazuje jednom; spremanjem postavki uklanjaju se ponavljanja.` : 'Nema ponovljenih naziva aplikacija.'}</p>
            <div aria-label="Popis aplikacija" className="max-h-64 overflow-y-auto pr-2 space-y-2">
              {visibleApps.map(app => (
                <div key={app} className="flex flex-wrap gap-2 justify-between items-center bg-slate-800/50 p-2 px-3 rounded-lg border border-slate-700/50">
                  {editingApp === app ? <>
                    <input autoFocus aria-label="Uredi naziv aplikacije" className="glass-input w-full min-w-0" value={editedAppName}
                      onChange={e => { setEditedAppName(e.target.value); setAppError(''); }}
                      onKeyDown={e => { if (e.key === 'Enter') confirmAppName(); if (e.key === 'Escape') { setEditingApp(null); setAppError(''); } }} />
                    <div className="flex gap-2">
                      <button onClick={confirmAppName} className="text-sm text-emerald-400 hover:text-emerald-300">Potvrdi naziv</button>
                      <button onClick={() => { setEditingApp(null); setAppError(''); }} className="text-sm text-slate-400 hover:text-white">Odustani od uređivanja</button>
                    </div>
                  </> : <>
                  <span className="text-slate-300 text-sm font-medium break-words min-w-0 flex-1">{formatAppName(app, appNames)}</span>
                  <button disabled={editingApp !== null || saving} aria-label={`Uredi aplikaciju ${formatAppName(app, appNames)}`} onClick={() => { setEditingApp(app); setEditedAppName(formatAppName(app, appNames)); setAppError(''); }} className="text-xs text-indigo-400 hover:text-indigo-300 disabled:opacity-40">Uredi</button>
                  <button disabled={editingApp !== null || saving} aria-label={`Ukloni aplikaciju ${formatAppName(app, appNames)}`} onClick={() => removeItem('apps', app)} className="text-slate-500 hover:text-red-400 transition-colors disabled:opacity-40">
                    <Trash2 size={16} />
                  </button>
                  </>}
                </div>
              ))}
            </div>
          </div>

          {/* Contacts Editor */}
          <div className="bg-slate-900/50 rounded-xl p-4 border border-slate-800">
            <h3 className="text-lg font-semibold text-slate-200 mb-4">Padajući izbornik: Kontakti</h3>
            <div className="flex gap-2 mb-4">
              <input 
                type="text" 
                className="glass-input flex-1 uppercase" 
                placeholder="Unesi novi kontakt..." 
                value={newContact}
                onChange={(e) => setNewContact(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addItem('contacts')}
              />
              <button onClick={() => addItem('contacts')} className="btn bg-indigo-600 hover:bg-indigo-500 text-white px-3"><Plus size={20}/></button>
            </div>
            <div className="max-h-64 overflow-y-auto pr-2 space-y-2">
              {contacts.map(contact => (
                <div key={contact} className="flex justify-between items-center bg-slate-800/50 p-2 px-3 rounded-lg border border-slate-700/50">
                  <span className="text-slate-300 text-sm font-medium">{contact}</span>
                  <button onClick={() => removeItem('contacts', contact)} className="text-slate-500 hover:text-red-400 transition-colors">
                    <Trash2 size={16} />
                  </button>
             </div>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-8 bg-slate-900/50 rounded-xl p-4 border border-slate-800">
          <h3 className="text-lg font-semibold text-slate-200 mb-2">Umjetna Inteligencija (Google Gemini API)</h3>
          <p className="text-sm text-slate-400 mb-4">Unesite Vaš privatni Gemini API ključ kako bi AI Asistent i Kontrolni Centar za Obavijesti funkcionirali. Ključ se sigurno sprema na Vaš Firebase.</p>
          <input 
            type="password" 
            className="glass-input w-full" 
            placeholder="AIzaSyA..." 
            value={geminiApiKey}
            onChange={(e) => setGeminiApiKey(e.target.value)}
          />
        </div>

        <div className="mt-8 bg-slate-900/50 rounded-xl p-4 border border-slate-800">
          <h3 className="text-lg font-semibold text-slate-200 mb-2">Uvoz Kontakata</h3>
          <p className="text-sm text-slate-400 mb-4">Otvorite alat za ručni uvoz i pametno povezivanje kontakata iz .csv ili .vcf datoteka.</p>
          <button onClick={onOpenManualSync} className="btn bg-indigo-600 hover:bg-indigo-500 text-white w-full py-3 mb-4">
            Pokreni alat za uvoz kontakata
          </button>
          
          <div className="pt-4 border-t border-slate-700/50 mt-2">
            <h3 className="text-lg font-semibold text-slate-200 mb-2">Sigurnosna Kopija (Backup)</h3>
            <p className="text-sm text-slate-400 mb-4">Preuzmite kompletnu bazu podataka sa svim korisnicima, pretplatama i evidencijom na Vaše računalo.</p>
            <div className="flex gap-4">
              <button onClick={handleBackup} className="btn bg-slate-700 hover:bg-slate-600 text-white flex-1 py-3 flex items-center justify-center gap-2">
                <Download size={18} /> Izvezi (JSON)
              </button>
              <label className="btn bg-slate-700 hover:bg-slate-600 text-white flex-1 py-3 flex items-center justify-center gap-2 cursor-pointer">
                <Upload size={18} /> Uvezi Backup
                <input type="file" accept=".json" className="hidden" onChange={handleRestore} />
              </label>
            </div>
          </div>
        </div>
        </>
        )}

        {activeTab === 'tags' && (
          <div className="bg-slate-900/50 rounded-xl p-4 border border-slate-800">
            <h3 className="text-lg font-semibold text-slate-200 mb-4">Oznake (Tags)</h3>
            <p className="text-sm text-slate-400 mb-4">Kreirajte oznake koje možete dodijeliti korisnicima (npr. VIP, Problematičan).</p>
            <div className="flex gap-2 mb-4">
              <input 
                type="text" 
                className="glass-input flex-1" 
                placeholder="Unesi novu oznaku..." 
                value={newTag}
                onChange={(e) => setNewTag(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addItem('tags')}
              />
              <button onClick={() => addItem('tags')} className="btn bg-indigo-600 hover:bg-indigo-500 text-white px-3"><Plus size={20}/></button>
            </div>
            <div className="max-h-64 overflow-y-auto pr-2 space-y-2">
              {tags.map(tag => (
                <div key={tag} className="flex justify-between items-center bg-slate-800/50 p-2 px-3 rounded-lg border border-slate-700/50">
                  <span className="text-slate-300 text-sm font-medium">{tag}</span>
                  <button onClick={() => removeItem('tags', tag)} className="text-slate-500 hover:text-red-400 transition-colors">
                    <Trash2 size={16} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {activeTab === 'messages' && (
          <div className="bg-slate-900/50 rounded-xl p-4 border border-slate-800">
            <h3 className="text-lg font-semibold text-slate-200 mb-2">Predlošci za Poruke</h3>
            <p className="text-sm text-slate-400 mb-6">Ove poruke možete brzo odabrati kod slanja obavijesti. Koristite `{"{ime}"}` da ubacite ime korisnika.</p>
            
            <div className="bg-slate-800/80 p-4 rounded-lg border border-indigo-500/30 mb-8">
              <h4 className="text-md font-semibold text-indigo-400 mb-2">Poruka za brzi gumb (u tablici)</h4>
              <p className="text-xs text-slate-400 mb-3">Ova poruka se generira kada kliknete na mali WhatsApp/Viber gumbić direktno u redu tablice korisnika.</p>
              <textarea 
                className="w-full glass-input h-20 text-sm" 
                value={quickMessageTemplate} 
                onChange={e => setQuickMessageTemplate(e.target.value)} 
              />
            </div>
            
            <h4 className="text-md font-semibold text-slate-300 mb-4">Ostali predlošci (za Kontrolni Centar)</h4>
            <div className="space-y-4">
              {templates.map((tpl, idx) => (
                <div key={tpl.id} className="bg-slate-800/50 p-4 rounded-lg border border-slate-700/50">
                  <div className="mb-2">
                    <label className="block text-xs text-slate-400 mb-1">Naziv Predloška</label>
                    <input type="text" className="w-full glass-input" value={tpl.name} onChange={e => {
                      const newTpls = [...templates];
                      newTpls[idx].name = e.target.value;
                      setTemplates(newTpls);
                    }} />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">Tekst poruke</label>
                    <textarea className="w-full glass-input h-20 text-sm" value={tpl.text} onChange={e => {
                      const newTpls = [...templates];
                      newTpls[idx].text = e.target.value;
                      setTemplates(newTpls);
                    }} />
                  </div>
                </div>
              ))}
            </div>
            <button 
              onClick={() => {
                setTemplates([...templates, { id: crypto.randomUUID(), name: "Novi predložak", text: "Poštovani {ime}, ..." }]);
              }}
              className="mt-4 btn btn-sm btn-ghost text-emerald-400 border border-emerald-400/30 hover:bg-emerald-400/10 w-full"
            >
              <Plus size={16} className="inline mr-2" />
              Dodaj Novi Predložak
            </button>
          </div>
        )}

        {activeTab === 'prices' && (
          <div className="bg-slate-900/50 rounded-xl p-4 border border-slate-800">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-semibold text-slate-200">Javni Cjenik i Paketi</h3>
              <a href="/cjenik" target="_blank" className="text-emerald-400 hover:text-emerald-300 text-sm font-medium flex items-center gap-1">
                Javni Cjenik ↗
              </a>
            </div>
            
            <div className="mb-6 space-y-4 border-b border-slate-700/50 pb-6">
              <div>
                <label className="block text-sm text-slate-400 mb-1">Glavni naslov stranice</label>
                <input type="text" className="w-full glass-input" value={cjenikTitle} onChange={e => setCjenikTitle(e.target.value)} />
              </div>
              <div>
                <label className="block text-sm text-slate-400 mb-1">Podnaslov (Opis)</label>
                <textarea className="w-full glass-input h-20" value={cjenikSubtitle} onChange={e => setCjenikSubtitle(e.target.value)} />
              </div>
              <div>
                <label className="block text-sm text-slate-400 mb-1">Važne Napomene (odvojene zarezom ili u novom redu)</label>
                <textarea 
                  className="w-full glass-input h-24" 
                  value={cjenikNotes.join('\n')} 
                  onChange={e => setCjenikNotes(e.target.value.split('\n').map(n => n.trim()).filter(n => n))} 
                />
              </div>
            </div>

            <p className="text-sm text-slate-400 mb-4 font-medium">Paketi pretplate (prikazuju se i u aplikaciji za brzo produženje)</p>
            <div className="space-y-4">
              {prices.map((pkg, idx) => (
                <div key={pkg.id} className="bg-slate-800/50 p-4 rounded-lg border border-slate-700/50 relative">
                  <button 
                    onClick={() => setPrices(prices.filter((_, i) => i !== idx))} 
                    className="absolute top-2 right-2 text-slate-500 hover:text-red-400"
                    title="Obriši paket"
                  >
                    <X size={16} />
                  </button>
                  <div className="flex gap-4 pr-6">
                    <div className="flex-1">
                      <label className="block text-xs text-slate-400 mb-1">Naziv Paketa</label>
                      <input type="text" className="w-full glass-input" value={pkg.name} onChange={e => {
                        const newPrices = [...prices];
                        newPrices[idx].name = e.target.value;
                        setPrices(newPrices);
                      }} />
                    </div>
                    <div className="w-32">
                      <label className="block text-xs text-slate-400 mb-1">Trajanje</label>
                      <select 
                        className="w-full glass-input"
                        value={pkg.months || 1}
                        onChange={e => {
                          const newPrices = [...prices];
                          newPrices[idx].months = Number(e.target.value);
                          setPrices(newPrices);
                        }}
                      >
                        <option value={1} className="text-black">1 Mjesec</option>
                        <option value={3} className="text-black">3 Mjeseca</option>
                        <option value={6} className="text-black">6 Mjeseci</option>
                        <option value={12} className="text-black">1 Godina</option>
                      </select>
                    </div>
                    <div className="w-24">
                      <label className="block text-xs text-slate-400 mb-1">Cijena (€)</label>
                      <input type="number" className="w-full glass-input" value={pkg.price} onChange={e => {
                        const newPrices = [...prices];
                        newPrices[idx].price = Number(e.target.value);
                        setPrices(newPrices);
                      }} />
                    </div>
                  </div>
                  <div className="flex gap-4 mt-3">
                    <div className="flex-1">
                      <label className="block text-xs text-slate-400 mb-1">Značajke (svaka u novom redu)</label>
                      <textarea className="w-full glass-input text-xs h-24" value={pkg.features.join('\n')} onChange={e => {
                        const newPrices = [...prices];
                        newPrices[idx].features = e.target.value.split('\n').map(f => f.trim()).filter(f => f);
                        setPrices(newPrices);
                      }} />
                    </div>
                    <div className="w-1/3 flex flex-col gap-3">
                      <div>
                        <label className="block text-xs text-slate-400 mb-1">Oznaka na kartici (opcionalno)</label>
                        <input type="text" className="w-full glass-input text-xs" placeholder="Npr. NAJVEĆA UŠTEDA!" value={pkg.badge || ''} onChange={e => {
                          const newPrices = [...prices];
                          newPrices[idx].badge = e.target.value;
                          setPrices(newPrices);
                        }} />
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <button 
              onClick={() => {
                setPrices([...prices, { id: crypto.randomUUID(), name: "Novi paket", price: 10, features: ["Značajka 1"], months: 1 }]);
              }}
              className="mt-4 btn btn-sm btn-ghost text-emerald-400 border border-emerald-400/30 hover:bg-emerald-400/10 w-full"
            >
              <Plus size={16} className="inline mr-2" />
              Dodaj Novi Paket
            </button>
          </div>
        )}

        <div className="flex justify-end gap-4 mt-8 pt-4 border-t border-slate-800">
          <button onClick={onClose} className="btn btn-ghost">Odustani</button>
          <button onClick={handleSave} disabled={saving} className="btn btn-primary flex items-center gap-2">
            <Check size={18} />
            {saving ? "Spremanje..." : "Spremi Postavke"}
          </button>
        </div>
      </div>
    </div>
  );
}

const AI_TOOLS: GeminiTool[] = [
  {
    functionDeclarations: [
      {
        name: "filter_table",
        description: "Filtrira glavnu tablicu na ekranu. Npr. ako korisnik pita za neplaćene, pošalji 'nije plaćeno'. Ako pita za određeno ime, pošalji to ime.",
        parameters: {
          type: "OBJECT",
          properties: {
            query: { type: "STRING", description: "Pojam za pretragu (ime, status, aplikacija...)" }
          },
          required: ["query"]
        }
      },
      {
        name: "update_subscription",
        description: "Ažurira podatke o pretplati (npr. postavlja da je plaćeno ili mijenja datum isteka).",
        parameters: {
          type: "OBJECT",
          properties: {
            id: { type: "STRING", description: "ID korisnika kojeg ažuriramo (moraš ga naći u bazi koju sam ti poslao)" },
            name: { type: "STRING", description: "Ime i prezime korisnika" },
            isPaid: { type: "BOOLEAN", description: "Je li plaćeno (true/false). Pošalji samo ako se mijenja." },
            expirationDate: { type: "STRING", description: "Novi datum isteka u formatu YYYY-MM-DD. Pošalji samo ako se mijenja." },
            app: { type: "STRING", description: "Aplikacija koju koristi" },
            macAddress: { type: "STRING", description: "MAC Adresa" },
            deviceKey: { type: "STRING", description: "Device Key" },
            note: { type: "STRING", description: "Napomena" },
            contact: { type: "STRING", description: "Kontakt metoda (npr. WhatsApp, Viber)" },
            phone: { type: "STRING", description: "Broj telefona" },
            email: { type: "STRING", description: "Email adresa" }
          },
          required: ["id"]
        }
      },
      {
        name: "add_subscription",
        description: "Dodaje novog korisnika u bazu.",
        parameters: {
          type: "OBJECT",
          properties: {
            name: { type: "STRING", description: "Ime i prezime korisnika" },
            isPaid: { type: "BOOLEAN", description: "Je li plaćeno (true/false)." },
            expirationDate: { type: "STRING", description: "Datum isteka u formatu YYYY-MM-DD." },
            app: { type: "STRING", description: "Aplikacija koju koristi" },
            macAddress: { type: "STRING", description: "MAC Adresa" },
            deviceKey: { type: "STRING", description: "Device Key" },
            note: { type: "STRING", description: "Napomena" },
            contact: { type: "STRING", description: "Kontakt metoda (npr. WhatsApp, Viber)" },
            phone: { type: "STRING", description: "Broj telefona" },
            email: { type: "STRING", description: "Email adresa" }
          },
          required: ["name"]
        }
      },
      {
        name: "delete_subscription",
        description: "Briše korisnika iz baze podataka.",
        parameters: {
          type: "OBJECT",
          properties: {
            id: { type: "STRING", description: "ID korisnika kojeg brišemo" }
          },
          required: ["id"]
        }
      }
    ]
  }
];

function AIModal({ 
  data, 
  apiKey, 
  onClose,
  setSearch,
  updateSubscription,
  addSubscription,
  deleteSubscription
}: { 
  data: Subscription[], 
  apiKey: string, 
  onClose: () => void,
  setSearch: (s: string) => void,
  updateSubscription: (id: string, updates: Partial<Subscription>) => Promise<void>,
  addSubscription: (sub: Omit<Subscription, "id" | "createdAt">) => Promise<any>,
  deleteSubscription: (id: string) => Promise<void>
}) {
  const [messages, setMessages] = useState<GeminiMessage[]>([
    { role: 'model', parts: [{ text: 'Bok! Ja sam vaš osobni asistent za bazu. Od sada vam mogu pomoći filtrirati tablicu ili ažurirati podatke (uz vašu dozvolu). Što trebate?' }] }
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [pendingAction, setPendingAction] = useState<{name: string, args: any} | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, pendingAction]);

  const handleSend = async (customMsg?: string | any) => {
    const isCustomMsgString = typeof customMsg === 'string';
    const userMsgText = isCustomMsgString ? customMsg : input.trim();
    if (!userMsgText || !apiKey) return;
    
    let newMessages = [...messages];
    if (!isCustomMsgString) {
      newMessages.push({ role: 'user', parts: [{ text: userMsgText }] });
      setMessages(newMessages);
      setInput('');
    }
    
    setLoading(true);

    try {
      const contextData = data.map(u => ({
        id: u.id,
        ime: u.name,
        istek: u.expirationDate,
        app: u.app,
        platio: u.isPaid ? 'Da' : 'Ne',
        napomena: u.note
      }));
      
      const systemPrompt = `Ti si AI CRM asistent za vlasnika IPTV baze.
Trenutni datum: ${new Date().toLocaleDateString('hr-HR')}
Baza korisnika (JSON):
${JSON.stringify(contextData)}

Važna pravila:
1. Kad te korisnik pita da "filtriraš", "prikažeš", "nađeš", pozovi funkciju filter_table s ključnom riječi.
2. Kad te korisnik traži da "promijeniš", "produžiš", "urediš", "ispraviš" podatke (ime, aplikaciju, napomenu, status plaćanja, datum isteka), pozovi funkciju update_subscription.
3. Kad korisnik traži da "dodaš" novog korisnika, pozovi add_subscription.
4. Kad korisnik traži da "obrišeš" ili "izbrišeš" korisnika, pozovi delete_subscription.
5. Za pronalaženje korisnika kojeg treba ažurirati ili brisati, POGLEDAJ 'id' U BAZI IZNAD i obavezno ga proslijedi u funkciju.`;

      const getApiMessages = (msgs: GeminiMessage[]) => msgs[0]?.role === 'model' ? msgs.slice(1) : msgs;
      const responseMsg = await callGeminiChat(getApiMessages(newMessages), systemPrompt, apiKey, AI_TOOLS);
      const funcCall = responseMsg.parts?.find((p: any) => p.functionCall)?.functionCall;
      
      if (funcCall) {
        if (funcCall.name === 'filter_table') {
          // Execute automatically
          setSearch(funcCall.args.query);
          const funcResponse: GeminiMessage = {
            role: 'function',
            parts: [{ functionResponse: { name: 'filter_table', response: { success: true, filteredBy: funcCall.args.query } } }]
          };
          newMessages = [...newMessages, responseMsg, funcResponse];
          setMessages(newMessages);
          
          // Call again to get text response
          const finalResponse = await callGeminiChat(getApiMessages(newMessages), systemPrompt, apiKey, AI_TOOLS);
          setMessages([...newMessages, finalResponse]);
        } else if (['update_subscription', 'add_subscription', 'delete_subscription'].includes(funcCall.name)) {
          // Ask for permission
          setMessages([...newMessages, responseMsg]);
          setPendingAction(funcCall as any);
        }
      } else {
        setMessages([...newMessages, responseMsg]);
      }
    } catch (err: any) {
      setMessages([...newMessages, { role: 'model', parts: [{ text: `Greška: ${err.message}` }] }]);
    } finally {
      setLoading(false);
    }
  };

  const handleApproveAction = async () => {
    if (!pendingAction) return;
    setLoading(true);
    try {
      let funcResponseContent = { success: true };
      
      if (pendingAction.name === 'update_subscription') {
        const { id, ...updatesToApply } = pendingAction.args;
        await updateSubscription(id, updatesToApply);
      } else if (pendingAction.name === 'add_subscription') {
        await addSubscription(pendingAction.args);
      } else if (pendingAction.name === 'delete_subscription') {
        await deleteSubscription(pendingAction.args.id);
      }
      
      const funcResponse: GeminiMessage = {
        role: 'function',
        parts: [{ functionResponse: { name: pendingAction.name, response: funcResponseContent } }]
      };
      
      const newMessages = [...messages, funcResponse];
      setMessages(newMessages);
      setPendingAction(null);
      
      // Call Gemini again to confirm
      const contextData = data.map(u => ({ id: u.id, ime: u.name, istek: u.expirationDate, app: u.app, platio: u.isPaid ? 'Da' : 'Ne', napomena: u.note }));
      const systemPrompt = `Ti si AI CRM asistent. Korisnik je upravo odobrio i izvršio tvoju akciju u bazi. Baza korisnika: ${JSON.stringify(contextData)}`;
      const apiMessages = newMessages[0]?.role === 'model' ? newMessages.slice(1) : newMessages;
      const finalResponse = await callGeminiChat(apiMessages, systemPrompt, apiKey, AI_TOOLS);
      setMessages([...newMessages, finalResponse]);
      
    } catch (err: any) {
      alert("Greška kod ažuriranja baze: " + err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleDenyAction = () => {
    if (!pendingAction) return;
    const funcResponse: GeminiMessage = {
      role: 'function',
      parts: [{ functionResponse: { name: pendingAction.name, response: { success: false, reason: "Korisnik je odbio akciju." } } }]
    };
    setMessages([...messages, funcResponse]);
    setPendingAction(null);
    // Optionally trigger a new chat round to let Gemini say "U redu, akcija je otkazana."
    handleSend("Korisnik je odbio akciju.");
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 overflow-y-auto">
      <div className="glass-panel p-6 md:p-8 max-w-2xl w-full animate-in zoom-in-95 duration-200 my-8">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-4 text-purple-400">
            <Bot size={32} />
            <h2 className="text-xl font-bold">AI Asistent (Gemini)</h2>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white"><X size={24} /></button>
        </div>
        
        {!apiKey && (
          <div className="bg-red-500/20 text-red-400 p-4 rounded-lg mb-4 border border-red-500/30 flex items-center gap-3">
            <AlertTriangle size={24} className="shrink-0" />
            <p className="text-sm">Niste unijeli Gemini API ključ! Idite u Postavke (Zupčanik ikona) i unesite svoj ključ kako biste aktivirali asistenta.</p>
          </div>
        )}

        <div className="bg-slate-900/50 rounded-xl p-4 mb-4 h-[400px] overflow-y-auto border border-slate-800 flex flex-col gap-4">
          {messages.map((msg, i) => {
            const isUser = msg.role === 'user';
            const textPart = msg.parts?.find((p: any) => p.text)?.text;
            if (!textPart) return null; // Skip function calls/responses in UI
            
            return (
              <div key={i} className={cn("flex", isUser ? "justify-end" : "justify-start")}>
                <div className={cn("max-w-[80%] p-3 rounded-2xl text-sm", 
                  isUser ? "bg-purple-600 text-white rounded-br-none" : "bg-slate-800 text-slate-200 rounded-bl-none border border-slate-700")}>
                  <span className="font-bold text-xs opacity-50 block mb-1">{isUser ? 'Vi' : 'AI Asistent'}</span>
                  <div className="whitespace-pre-wrap">{textPart}</div>
                </div>
              </div>
            );
          })}
          
          {pendingAction && (
            <div className="flex justify-start">
              <div className="max-w-[80%] p-4 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-amber-200 rounded-bl-none text-sm">
                <div className="flex items-center gap-2 font-bold mb-2">
                  <AlertTriangle size={16} />
                  Odobrenje Akcije
                </div>
                <p className="mb-3">
                  Asistent želi izmijeniti bazu ({
                    pendingAction.name === 'update_subscription' ? 'Ažuriranje pretplate' : 
                    pendingAction.name === 'add_subscription' ? 'Dodavanje novog korisnika' :
                    pendingAction.name === 'delete_subscription' ? 'Brisanje korisnika' : pendingAction.name
                  }):<br/>
                  <span className="font-mono text-xs opacity-80 mt-1 block bg-black/20 p-2 rounded">{JSON.stringify(pendingAction.args, null, 2)}</span>
                </p>
                <div className="flex gap-2">
                  <button onClick={handleApproveAction} disabled={loading} className="btn btn-sm bg-emerald-600 hover:bg-emerald-500 text-white flex-1">
                    Dozvoli
                  </button>
                  <button onClick={handleDenyAction} disabled={loading} className="btn btn-sm bg-slate-700 hover:bg-slate-600 text-white flex-1">
                    Odbij
                  </button>
                </div>
              </div>
            </div>
          )}

          {loading && !pendingAction && (
            <div className="flex justify-start">
              <div className="bg-slate-800 p-3 rounded-2xl rounded-bl-none border border-slate-700 text-slate-400 text-sm animate-pulse">
                Asistent razmišlja...
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>
        
        <div className="flex gap-2">
          <input 
            type="text" 
            className="glass-input flex-1"
            placeholder="Pitajte me o vašim korisnicima..." 
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSend()}
            disabled={!apiKey || loading}
          />
          <button onClick={() => handleSend()} disabled={!apiKey || loading || !input.trim()} className="btn bg-purple-600 hover:bg-purple-500 text-white disabled:opacity-50">Pošalji</button>
        </div>
      </div>
    </div>
  );
}

function NotifyControlCenterModal({ selectedIds, data, apiKey, onClose }: { selectedIds: string[], data: Subscription[], apiKey: string, onClose: () => void }) {
  const [activeTab, setActiveTab] = useState<'expiration' | 'promotion'>('expiration');
  const [template, setTemplate] = useState("Poštovani, vaša pretplata uskoro ističe. Molimo Vas da ju obnovite.");
  const [promoTemplate, setPromoTemplate] = useState("Poštovani, iskoristite našu novu promociju za vjerne korisnike!");
  const [aiLoading, setAiLoading] = useState(false);
  
  const currentTemplate = activeTab === 'expiration' ? template : promoTemplate;
  const setCurrentTemplate = activeTab === 'expiration' ? setTemplate : setPromoTemplate;
  
  // Selection state inside modal
  const [modalSelectedIds, setModalSelectedIds] = useState<string[]>([]);
  
  // Queue state
  const [queueIndex, setQueueIndex] = useState<number | null>(null);

  // Users data for current tab
  const tabUsers = useMemo(() => {
    if (activeTab === 'expiration') {
      const filtered = data.filter(u => {
        if (!u.expirationDate) return false;
        const parsed = parseAnyDate(u.expirationDate);
        if (!parsed) return false;
        const now = new Date();
        parsed.setHours(0,0,0,0);
        now.setHours(0,0,0,0);
        const daysLeft = differenceInDays(parsed, now);
        return daysLeft <= 5 && daysLeft >= -30;
      });
      return filtered.sort((a,b) => {
        const da = parseAnyDate(a.expirationDate || '');
        const db = parseAnyDate(b.expirationDate || '');
        if (da && db) return da.getTime() - db.getTime();
        return 0;
      });
    } else {
      // Promotions tab shows all users, sorting alphabetically
      return data.slice().sort((a,b) => a.name.localeCompare(b.name));
    }
  }, [data, activeTab]);

  // Grouping logic for expiration tab
  const groups = useMemo(() => {
    const g = {
      expired: [] as Subscription[],
      today: [] as Subscription[],
      tomorrow: [] as Subscription[],
      soon: [] as Subscription[],
      later: [] as Subscription[]
    };
    if (activeTab === 'promotion') return g;
    
    tabUsers.forEach(u => {
      if (!u.expirationDate) return;
      const parsed = parseAnyDate(u.expirationDate);
      if (!parsed) return;
      const daysLeft = differenceInDays(parsed, new Date());
      
      if (daysLeft < 0) g.expired.push(u);
      else if (daysLeft === 0) g.today.push(u);
      else if (daysLeft === 1) g.tomorrow.push(u);
      else if (daysLeft <= 3) g.soon.push(u);
      else g.later.push(u);
    });
    return g;
  }, [tabUsers, activeTab]);

  useEffect(() => {
    if (selectedIds.length > 0) {
      setModalSelectedIds(selectedIds);
    }
  }, [selectedIds]);
  
  const handleToggleSelect = (id: string) => {
    setModalSelectedIds(prev => 
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  };
  
  const handleToggleGroup = (usersInGroup: Subscription[]) => {
    const groupIds = usersInGroup.map(u => u.id);
    const allSelected = groupIds.every(id => modalSelectedIds.includes(id));
    if (allSelected) {
      setModalSelectedIds(prev => prev.filter(id => !groupIds.includes(id)));
    } else {
      const newIds = groupIds.filter(id => !modalSelectedIds.includes(id));
      setModalSelectedIds(prev => [...prev, ...newIds]);
    }
  };

  const handleGenerateAI = async (contextText: string) => {
    if (!apiKey) return alert("Molimo unesite Gemini API ključ u postavkama!");
    setAiLoading(true);
    try {
      let prompt = "";
      if (activeTab === 'expiration') {
        prompt = `Napiši kratku, prijateljsku poruku za korisnika kojem pretplata za televiziju ističe: ${contextText}. Poruka treba biti profesionalna i potaknuti ga na produljenje. Bez placeholder varijabli poput [Ime] nego ostavi univerzalno (npr. Poštovani, ...). Na hrvatskom jeziku, max 3 rečenice.`;
      } else {
        prompt = `Napiši kratku, prijateljsku PROMOTIVNU poruku za korisnika usluge televizije. Poruka treba nuditi neku pogodnost, popust ili novost, te potaknuti interes. Bez placeholder varijabli poput [Ime] nego ostavi univerzalno (npr. Poštovani, ...). Na hrvatskom jeziku, max 3 rečenice.`;
      }
      const reply = await callGemini(prompt, "Ti si stručnjak za komunikaciju i prodaju.", apiKey);
      setCurrentTemplate(reply);
    } catch (err) {
      alert("Greška kod AI generiranja.");
    } finally {
      setAiLoading(false);
    }
  };

  const handleCopySelectedNumbers = () => {
    const selectedUsers = tabUsers.filter(u => modalSelectedIds.includes(u.id));
    const numbers = selectedUsers
      .filter(u => !!u.phone)
      .flatMap(u => String(u.phone).split(',').map(n => n.trim()).filter(n => n.length > 0));
      
    if (numbers.length === 0) {
      return alert("Nema brojeva za kopiranje odabranih korisnika.");
    }
    
    const uniqueNumbers = Array.from(new Set(numbers));
    navigator.clipboard.writeText(uniqueNumbers.join('\n'));
    alert(`Kopirano ${uniqueNumbers.length} brojeva!`);
  };

  const validQueueUsers = useMemo(() => {
    return tabUsers.filter(u => modalSelectedIds.includes(u.id) && !!u.phone);
  }, [tabUsers, modalSelectedIds]);

  const parseMessageTemplate = (template: string, user: Subscription) => {
    return template
      .replace(/{ime}/gi, user.name || '')
      .replace(/{datum}/gi, user.expirationDate || '');
  };

  const startQueue = () => {
    if (validQueueUsers.length === 0) return alert("Odaberite barem jednog korisnika s brojem telefona za slanje.");
    setQueueIndex(0);
    const msg = parseMessageTemplate(currentTemplate, validQueueUsers[0]);
    navigator.clipboard.writeText(msg).catch(() => {});
    window.open(generateMessageLink(validQueueUsers[0].phone!, msg, validQueueUsers[0].contact), '_blank');
  };
  
  const handleQueueNext = () => {
    if (queueIndex === null || queueIndex >= validQueueUsers.length) return;
    
    const nextIndex = queueIndex + 1;
    if (nextIndex < validQueueUsers.length) {
      setQueueIndex(nextIndex);
      const msg = parseMessageTemplate(currentTemplate, validQueueUsers[nextIndex]);
      navigator.clipboard.writeText(msg).catch(() => {});
      window.open(generateMessageLink(validQueueUsers[nextIndex].phone!, msg, validQueueUsers[nextIndex].contact), '_blank');
    } else {
      setQueueIndex(null);
      alert("Slanje završeno!");
      setModalSelectedIds([]);
    }
  };
  
  const stopQueue = () => {
    setQueueIndex(null);
  };

  const renderGroup = (title: string, users: Subscription[], urgencyText: string) => {
    if (users.length === 0) return null;
    const groupIds = users.map(u => u.id);
    const allSelected = groupIds.every(id => modalSelectedIds.includes(id));
    const someSelected = groupIds.some(id => modalSelectedIds.includes(id));

    return (
      <div className="mb-8">
        <div className="flex items-center justify-between mb-4 border-b border-slate-800 pb-2">
          <div className="flex items-center gap-3">
            <input 
              type="checkbox" 
              checked={allSelected} 
              ref={input => { if (input) input.indeterminate = someSelected && !allSelected; }}
              onChange={() => handleToggleGroup(users)}
              className="w-4 h-4 rounded border-slate-600 bg-slate-800 text-purple-600 focus:ring-purple-600 focus:ring-offset-slate-900"
            />
            <h3 className="text-lg font-bold text-slate-200 flex items-center gap-2">
              {title} <span className="bg-slate-800 px-2 py-0.5 rounded-full text-xs">{users.length}</span>
            </h3>
          </div>
          <button 
            onClick={() => handleGenerateAI(urgencyText)}
            disabled={aiLoading}
            className="text-xs bg-purple-600/20 hover:bg-purple-600/40 text-purple-400 px-3 py-1 rounded-full flex items-center gap-1 transition-colors"
          >
            <Bot size={14} /> AI Predložak
          </button>
        </div>
        <div className="space-y-3">
          {users.map(user => (
            <div key={user.id} className="flex flex-col md:flex-row md:items-center justify-between bg-slate-800/50 p-3 rounded-lg border border-slate-700/50 gap-4 hover:border-slate-600 transition-colors">
              <div className="flex items-center gap-3">
                <input 
                  type="checkbox" 
                  checked={modalSelectedIds.includes(user.id)} 
                  onChange={() => handleToggleSelect(user.id)}
                  className="w-4 h-4 rounded border-slate-600 bg-slate-800 text-purple-600 focus:ring-purple-600 focus:ring-offset-slate-900"
                />
                <div>
                  <div className="text-slate-200 font-medium">{user.name}</div>
                  <div className="text-sm text-slate-400">Istek: {user.expirationDate} {user.phone ? `| Tel: ${user.phone}` : '| Nema unesen broj!'}</div>
                </div>
              </div>
              {user.phone ? (
                <a 
                  href={generateMessageLink(user.phone, parseMessageTemplate(currentTemplate, user), user.contact)} 
                  onClick={() => navigator.clipboard.writeText(parseMessageTemplate(currentTemplate, user)).catch(() => {})}
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="btn bg-green-600/90 hover:bg-green-500 text-white flex items-center gap-2 whitespace-nowrap text-sm px-4 py-1.5"
                >
                  <MessageSquare size={16} />
                  WhatsApp
                </a>
              ) : (
                <button disabled className="btn bg-slate-700 text-slate-500 cursor-not-allowed text-sm px-4 py-1.5">Nema broja</button>
              )}
            </div>
          ))}
        </div>
      </div>
    );
  };

  const isQueueActive = queueIndex !== null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 overflow-y-auto">
      <div className="glass-panel p-6 md:p-8 max-w-4xl w-full animate-in zoom-in-95 duration-200 my-8 flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between mb-4 shrink-0">
          <div className="flex items-center gap-3 text-white">
            <Bell size={28} className="text-amber-400" />
            <h2 className="text-2xl font-bold">Kontrolni Centar Obavijesti</h2>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white"><X size={24} /></button>
        </div>
        
        {/* Tabs */}
        <div className="flex gap-2 mb-6 border-b border-slate-700/50 pb-2 shrink-0">
          <button 
            onClick={() => { setActiveTab('expiration'); setModalSelectedIds([]); }}
            className={cn("px-4 py-2 rounded-t-lg font-medium transition-colors border-b-2", activeTab === 'expiration' ? "border-amber-400 text-amber-400 bg-amber-400/10" : "border-transparent text-slate-400 hover:text-slate-200")}
          >
            Istek Pretplate
          </button>
          <button 
            onClick={() => { setActiveTab('promotion'); setModalSelectedIds([]); }}
            className={cn("px-4 py-2 rounded-t-lg font-medium transition-colors border-b-2", activeTab === 'promotion' ? "border-emerald-400 text-emerald-400 bg-emerald-400/10" : "border-transparent text-slate-400 hover:text-slate-200")}
          >
            Promotivne Poruke
          </button>
        </div>
        
        <div className="bg-slate-900/50 p-5 rounded-xl border border-slate-800 mb-4 shrink-0 relative">
          <div className="flex justify-between items-center mb-3">
            <label className="text-sm font-bold text-emerald-400 flex items-center gap-2">
              <MessageSquare size={16} /> Vaša trenutna poruka za slanje:
            </label>
            {activeTab === 'promotion' && (
              <button 
                onClick={() => handleGenerateAI('promocija')}
                disabled={aiLoading}
                className="text-xs bg-purple-600/20 hover:bg-purple-600/40 text-purple-400 px-3 py-1 rounded-full flex items-center gap-1 transition-colors"
              >
                <Bot size={14} /> AI Predložak
              </button>
            )}
          </div>
          <textarea 
            className="w-full bg-slate-950/50 border border-slate-700 rounded-lg p-4 text-slate-200 focus:outline-none focus:border-emerald-500/50 transition-colors h-24" 
            value={currentTemplate}
            onChange={(e) => setCurrentTemplate(e.target.value)}
          ></textarea>
        </div>
        
        {/* Toolbar for bulk actions */}
        <div className="flex flex-wrap items-center justify-between gap-4 mb-4 shrink-0 bg-slate-800/50 p-3 rounded-lg border border-slate-700/50">
          <div className="text-slate-300 font-medium flex items-center gap-2">
            Odabrano korisnika: <span className="bg-purple-600/20 text-purple-400 px-2 rounded-md">{modalSelectedIds.length}</span>
          </div>
          <div className="flex gap-2">
            <button 
              onClick={handleCopySelectedNumbers}
              disabled={modalSelectedIds.length === 0}
              className="btn btn-sm bg-slate-700 hover:bg-slate-600 text-white flex items-center gap-2 disabled:opacity-50"
              title="Kopiraj brojeve odabranih korisnika"
            >
              <Copy size={16} />
              Kopiraj brojeve
            </button>
            <button 
              onClick={startQueue}
              disabled={modalSelectedIds.length === 0 || isQueueActive}
              className="btn btn-sm bg-purple-600 hover:bg-purple-500 text-white flex items-center gap-2 disabled:opacity-50"
            >
              <MessageSquare size={16} />
              Pošalji Odabranima (Queue)
            </button>
          </div>
        </div>

        {/* Queue active overlay/banner */}
        {isQueueActive && (
          <div className="mb-4 shrink-0 bg-amber-500/20 border border-amber-500/50 p-4 rounded-xl flex items-center justify-between shadow-[0_0_15px_rgba(245,158,11,0.2)]">
            <div>
              <h4 className="font-bold text-amber-400 text-lg mb-1">Slanje u tijeku...</h4>
              <p className="text-amber-200/80 text-sm">
                Trenutno šaljemo: <strong>{queueIndex + 1}</strong> od <strong>{validQueueUsers.length}</strong>. 
                Nakon što pritisnete pošalji u WhatsAppu, vratite se ovdje i kliknite Sljedeći.
              </p>
            </div>
            <div className="flex gap-3">
              <button onClick={stopQueue} className="btn bg-slate-800 hover:bg-slate-700 text-slate-300">
                Prekini
              </button>
              <button onClick={handleQueueNext} className="btn bg-green-600 hover:bg-green-500 text-white font-bold shadow-lg shadow-green-900/50">
                {queueIndex + 1 < validQueueUsers.length ? 'Sljedeći korisnik →' : 'Završi slanje'}
              </button>
            </div>
          </div>
        )}
        
        <div className="overflow-y-auto pr-2 custom-scrollbar flex-1 min-h-[200px]">
          {tabUsers.length === 0 ? (
            <div className="text-slate-500 text-center py-12 bg-slate-900/20 rounded-xl border border-dashed border-slate-800">
              Nema korisnika za prikaz u ovoj kategoriji.
            </div>
          ) : (
            activeTab === 'expiration' ? (
              <>
                {renderGroup("🔴 Već isteklo", groups.expired, "jučer ili ranije")}
                {renderGroup("🟠 Ističe DANAS", groups.today, "danas")}
                {renderGroup("🟡 Ističe SUTRA", groups.tomorrow, "sutra")}
                {renderGroup("🟢 Ističe USKORO (2-3 dana)", groups.soon, "za 2 do 3 dana")}
                {renderGroup("🔵 Ističe ZA 4-5 DANA", groups.later, "za 4 do 5 dana")}
              </>
            ) : (
              <div className="space-y-3 mt-2">
                <div className="flex items-center gap-3 mb-4 px-1">
                  <input 
                    type="checkbox" 
                    checked={modalSelectedIds.length === tabUsers.length && tabUsers.length > 0} 
                    onChange={() => handleToggleGroup(tabUsers)}
                    className="w-4 h-4 rounded border-slate-600 bg-slate-800 text-purple-600 focus:ring-purple-600 focus:ring-offset-slate-900"
                  />
                  <span className="text-slate-300 font-medium">Odaberi sve</span>
                </div>
                {tabUsers.map(user => (
                  <div key={user.id} className="flex flex-col md:flex-row md:items-center justify-between bg-slate-800/50 p-3 rounded-lg border border-slate-700/50 gap-4 hover:border-slate-600 transition-colors">
                    <div className="flex items-center gap-3">
                      <input 
                        type="checkbox" 
                        checked={modalSelectedIds.includes(user.id)} 
                        onChange={() => handleToggleSelect(user.id)}
                        className="w-4 h-4 rounded border-slate-600 bg-slate-800 text-purple-600 focus:ring-purple-600 focus:ring-offset-slate-900"
                      />
                      <div>
                        <div className="text-slate-200 font-medium">{user.name}</div>
                        <div className="text-sm text-slate-400">Istek: {user.expirationDate} {user.phone ? `| Tel: ${user.phone}` : '| Nema unesen broj!'}</div>
                      </div>
                    </div>
                    {user.phone ? (
                      <a 
                        href={generateMessageLink(user.phone, parseMessageTemplate(currentTemplate, user), user.contact)} 
                        onClick={() => navigator.clipboard.writeText(parseMessageTemplate(currentTemplate, user)).catch(() => {})}
                        target="_blank" 
                        rel="noopener noreferrer"
                        className="btn bg-green-600/90 hover:bg-green-500 text-white flex items-center gap-2 whitespace-nowrap text-sm px-4 py-1.5"
                      >
                        <MessageSquare size={16} />
                        WhatsApp
                      </a>
                    ) : (
                      <button disabled className="btn bg-slate-700 text-slate-500 cursor-not-allowed text-sm px-4 py-1.5">Nema broja</button>
                    )}
                  </div>
                ))}
              </div>
            )
          )}
        </div>
        
        <div className="flex justify-end gap-4 mt-6 pt-4 border-t border-slate-800 shrink-0">
          <button onClick={onClose} className="btn btn-ghost">Zatvori</button>
        </div>
      </div>
    </div>
  );
}

function ManualContactSyncModal({ subscriptions, onClose }: { subscriptions: Subscription[], onClose: () => void }) {
  const [parsedContacts, setParsedContacts] = useState<{name: string, phone: string, email: string}[]>([]);
  const [missingPhoneUsers, setMissingPhoneUsers] = useState<Subscription[]>([]);
  const [initialLoaded, setInitialLoaded] = useState(false);
  
  useEffect(() => {
    if (!initialLoaded && subscriptions.length > 0) {
      setMissingPhoneUsers(subscriptions.filter(s => !s.phone));
      setInitialLoaded(true);
    }
  }, [subscriptions, initialLoaded]);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      const content = evt.target?.result as string;
      if (file.name.toLowerCase().endsWith('.csv')) {
         const lines = content.split('\n');
         const headers = lines[0].split(',').map(h => h.trim().replace(/"/g, ''));
         const parsed = lines.slice(1).map(line => {
             const row = line.split(',').map(cell => cell.trim().replace(/"/g, ''));
             const obj: any = {};
             headers.forEach((h, i) => obj[h] = row[i]);
             return obj;
         });
         
         const contacts = parsed.map(p => ({
             name: `${p['First Name'] || ''} ${p['Last Name'] || ''}`.trim(),
             phone: p['Phone 1 - Value'] || p['Phone 2 - Value'] || '',
             email: p['E-mail 1 - Value'] || ''
         })).filter(c => c.name && c.phone);
         setParsedContacts(contacts);
      } else if (file.name.toLowerCase().endsWith('.vcf')) {
         const lines = content.split('\n');
         const contacts: {name: string, phone: string, email: string}[] = [];
         let current: any = null;
         for (const l of lines) {
             const line = l.trim();
             if (line === 'BEGIN:VCARD') current = {};
             else if (line === 'END:VCARD' && current?.name) contacts.push(current as any);
             else if (current) {
                 if (line.startsWith('FN:')) current.name = line.substring(3).trim();
                 else if (line.startsWith('TEL')) {
                     const parts = line.split(':');
                     if (parts.length > 1 && !current.phone) current.phone = parts[1].trim();
                 }
                 else if (line.startsWith('EMAIL')) {
                     const parts = line.split(':');
                     if (parts.length > 1 && !current.email) current.email = parts[1].trim();
                 }
             }
         }
         setParsedContacts(contacts);
      }
    };
    reader.readAsText(file);
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/80 backdrop-blur-sm p-4 overflow-hidden">
      <div className="glass-panel p-6 max-w-5xl w-full mx-auto my-8 flex flex-col h-full max-h-[85vh] overflow-hidden relative">
        <div className="flex justify-between items-center mb-6 shrink-0">
          <div className="flex items-center gap-3 text-white">
            <h2 className="text-2xl font-bold">Ručni alat za uvoz kontakata</h2>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white">
            <X size={24} />
          </button>
        </div>

        <div className="mb-6 shrink-0">
          <label className="block text-sm text-slate-400 mb-2">Učitajte datoteku s računala (.csv ili .vcf)</label>
          <input type="file" accept=".csv,.vcf" onChange={handleFileUpload} className="block w-full text-sm text-slate-400 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-indigo-600 file:text-white hover:file:bg-indigo-500 cursor-pointer bg-slate-900/50 rounded-full border border-slate-700 p-1" />
          {parsedContacts.length > 0 && <p className="text-emerald-400 text-sm mt-2">Uspješno pročitano {parsedContacts.length} kontakata. Možete započeti pretraživanje.</p>}
        </div>

        <div className="flex-1 overflow-y-auto custom-scrollbar border border-slate-800 rounded-xl p-4 bg-slate-900/30">
          {missingPhoneUsers.length === 0 ? (
            <div className="text-center py-12 text-slate-500">Svi Vaši korisnici već imaju upisan broj telefona! 🎉</div>
          ) : (
            <div className="space-y-4">
              {missingPhoneUsers.map(user => (
                <ManualSyncRow key={user.id} user={user} parsedContacts={parsedContacts} onLinked={(id) => setMissingPhoneUsers(prev => prev.filter(u => u.id !== id))} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ManualSyncRow({ user, parsedContacts, onLinked }: { user: Subscription, parsedContacts: any[], onLinked: (id: string) => void }) {
  const [searchTerm, setSearchTerm] = useState("");
  
  useEffect(() => {
    if (user.name) {
      setSearchTerm(user.name.split(' ')[0]);
    }
  }, [user.name]);

  const matches = parsedContacts.filter(c => c.name.toLowerCase().includes(searchTerm.toLowerCase()));
  const [selectedContactIndex, setSelectedContactIndex] = useState(0);
  const [isLinking, setIsLinking] = useState(false);

  const [isSuccess, setIsSuccess] = useState(false);

  const handleLink = async () => {
    const contact = matches[selectedContactIndex];
    if (!contact) return;
    setIsLinking(true);
    
    try {
      const updates: Partial<Subscription> = {};
      if (contact.phone) updates.phone = contact.phone;
      if (contact.email || user.email) updates.email = contact.email || user.email;
      
      await updateSubscription(user.id, updates);
      setIsSuccess(true);
      setTimeout(() => {
        onLinked(user.id);
      }, 2000);
    } catch (error) {
      console.error("Greška pri povezivaninfo:", error);
    } finally {
      setIsLinking(false);
    }
  };

  if (isSuccess) {
    return (
      <div className="flex gap-3 items-center bg-emerald-500/10 p-4 rounded-lg border border-emerald-500/30 text-emerald-400">
        <Check size={20} />
        <span className="font-bold">Uspješno povezano: {user.name}</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col md:flex-row gap-4 items-center bg-slate-800/40 p-4 rounded-lg border border-slate-700/50 hover:bg-slate-800/60 transition-colors">
      <div className="w-full md:w-1/4">
        <h4 className="text-white font-bold">{user.name}</h4>
        <p className="text-xs text-slate-400 mt-1">Nedostaje broj telefona</p>
      </div>
      <div className="w-full md:w-1/4 relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={16} />
        <input 
          type="text" 
          value={searchTerm} 
          onChange={e => { setSearchTerm(e.target.value); setSelectedContactIndex(0); }} 
          className="glass-input w-full py-2 pl-9 pr-3 text-sm" 
          placeholder="Pretraži imenik..." 
        />
      </div>
      <div className="w-full md:w-2/4 flex gap-3 items-center">
        {matches.length > 0 ? (
          <>
            <select 
              className="glass-input flex-1 min-w-0 w-full py-2 px-3 text-sm bg-slate-900 overflow-hidden text-ellipsis whitespace-nowrap" 
              value={selectedContactIndex} 
              onChange={e => setSelectedContactIndex(Number(e.target.value))}
            >
              {matches.slice(0, 20).map((m, i) => (
                <option key={i} value={i} className="truncate">{m.name} ({m.phone})</option>
              ))}
            </select>
            <button onClick={handleLink} disabled={isLinking} className="btn bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2 text-sm whitespace-nowrap shadow-lg shadow-emerald-900/20 shrink-0">
              {isLinking ? '...' : 'Poveži'}
            </button>
          </>
        ) : (
          <div className="flex-1 py-2 px-3 text-sm text-slate-500 italic bg-slate-900/50 rounded-lg border border-slate-800">
            Nema rezultata u imeniku.
          </div>
        )}
      </div>
    </div>
  );
}

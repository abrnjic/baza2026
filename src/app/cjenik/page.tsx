'use client';
import { useEffect, useState } from 'react';
import { AppSettings, PricePackage, subscribeToSettings } from '@/lib/db';
import { Check, Sparkles, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { motion } from 'framer-motion';

export default function PricingPage() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  
  useEffect(() => {
    const unsubscribe = subscribeToSettings((data) => {
      setSettings(data);
    });
    return () => unsubscribe();
  }, []);

  if (!settings) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#0B1020] text-white">
        <div className="animate-pulse flex flex-col items-center gap-4">
          <div className="w-12 h-12 border-4 border-purple-500 border-t-transparent rounded-full animate-spin"></div>
        </div>
      </div>
    );
  }

  // If there are no prices, we could provide the requested defaults.
  const prices = settings.prices && settings.prices.length > 0 ? settings.prices : [
    { id: '1', name: '1 MJESEC', months: 1, price: 8, features: ['2 uređaja', '4K, Full HD i HD kvaliteta', 'Brza aktivacija', 'Stabilni serveri', 'Tehnička podrška 24/7'] },
    { id: '2', name: '3 MJESECA', months: 3, price: 23, features: ['2 uređaja', '4K, Full HD i HD kvaliteta', 'Brza aktivacija', 'Stabilni serveri', 'Tehnička podrška 24/7'] },
    { id: '3', name: '6 MJESECI', months: 6, price: 45, features: ['2 uređaja', '4K, Full HD i HD kvaliteta', 'Brza aktivacija', 'Stabilni serveri', 'Tehnička podrška 24/7'] },
    { id: '4', name: '12 MJESECI', months: 12, price: 84, features: ['2 uređaja', '4K, Full HD i HD kvaliteta', 'Brza aktivacija', 'Stabilni serveri', 'Tehnička podrška 24/7'] }
  ];

  const title = settings.cjenikTitle || "ODABERITE SVOJ PAKET";
  const subtitle = settings.cjenikSubtitle || "Odaberite pretplatu koja vam najbolje odgovara.";
  const notes = settings.cjenikNotes && settings.cjenikNotes.length > 0 ? settings.cjenikNotes : [
    "Svi paketi dolaze bez ugovorne obveze (prepaid sistem).",
    "Gledanje na 2 uređaja istovremeno je moguće samo za različite IP adrese (ako nije drugačije navedeno).",
    "Preporučena minimalna brzina interneta je 20 Mbps za 4K sadržaj.",
    "Prihvaćamo razne načine plaćanja (PayPal, Kriptovalute, Bankovni prijenos)."
  ];

  return (
    <div className="min-h-screen bg-[#0B1020] text-slate-200 font-sans selection:bg-purple-500/30 pb-24">
      {/* Subtle Premium Background Glows */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none z-0">
        <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] rounded-full bg-purple-900/10 blur-[120px] mix-blend-screen" />
        <div className="absolute bottom-[-20%] right-[-10%] w-[50%] h-[50%] rounded-full bg-indigo-900/10 blur-[120px] mix-blend-screen" />
      </div>

      <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-24 pb-16">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
          className="text-center max-w-3xl mx-auto mb-20"
        >
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-white/[0.03] border border-white/[0.08] text-slate-300 text-sm font-medium mb-8 backdrop-blur-md">
            <Sparkles size={16} className="text-purple-400" />
            <span>Premium Usluga</span>
          </div>
          <h1 className="text-4xl md:text-5xl lg:text-6xl font-extrabold tracking-tight mb-6 text-white">
            {title}
          </h1>
          <p className="text-lg md:text-xl text-slate-400 font-light">
            {subtitle}
          </p>
        </motion.div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 lg:gap-8 items-center max-w-7xl mx-auto">
          {prices.map((pkg, idx) => {
            const months = Number(pkg.months);
            const is3Months = months === 3;
            const is6Months = months === 6;
            const is12Months = months === 12;

            // Determine badge based on instructions or override from settings
            let defaultBadge = null;
            if (is3Months) defaultBadge = "Povoljniji izbor";
            if (is6Months) defaultBadge = "🔥 Najpopularniji";
            if (is12Months) defaultBadge = "💎 Najbolja vrijednost";
            
            const badge = pkg.badge || defaultBadge;

            return (
              <motion.div 
                initial={{ opacity: 0, y: 30 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: idx * 0.1, ease: [0.22, 1, 0.36, 1] }}
                key={pkg.id} 
                className={cn(
                  "relative rounded-3xl p-8 transition-all duration-400",
                  "hover:-translate-y-2 group cursor-default",
                  "bg-[#131B2F] border border-white/[0.06] backdrop-blur-xl",
                  "hover:border-purple-500/30 hover:shadow-[0_8px_30px_rgba(168,85,247,0.12)]",
                  is6Months && "lg:scale-105 lg:hover:scale-[1.07] z-10 shadow-[0_0_40px_rgba(168,85,247,0.06)] border-purple-500/20",
                  is12Months && "bg-gradient-to-b from-[#1A223A] to-[#131B2F] border-indigo-500/20 hover:border-indigo-500/40"
                )}
              >
                {/* Badges */}
                {badge && (
                  <div className={cn(
                    "absolute -top-3.5 left-1/2 -translate-x-1/2 text-xs font-semibold px-4 py-1 rounded-full shadow-lg whitespace-nowrap",
                    is6Months ? "bg-gradient-to-r from-purple-500 to-pink-500 text-white" :
                    is12Months ? "bg-gradient-to-r from-indigo-400 to-purple-400 text-white" :
                    "bg-slate-800 text-slate-300 border border-slate-700"
                  )}>
                    {badge}
                  </div>
                )}
                
                <div className="mb-8">
                  <h3 className="text-slate-400 font-medium text-sm tracking-widest uppercase mb-4">{pkg.name}</h3>
                  <div className="flex items-baseline gap-2 mb-2">
                    <span className="text-5xl font-extrabold text-white tracking-tight">{pkg.price}</span>
                    <span className="text-slate-500 font-medium text-lg">EUR</span>
                  </div>
                </div>

                <ul className="space-y-4 mb-10 min-h-[220px]">
                  {pkg.features.map((feature, i) => (
                    <li key={i} className="flex items-start gap-3">
                      <div className="mt-0.5 shrink-0 text-purple-400">
                        <Check size={18} strokeWidth={3} />
                      </div>
                      <span className="text-slate-300 text-sm">{feature.replace(/^[✓✔]\s*/, '')}</span>
                    </li>
                  ))}
                </ul>

                <button 
                  className={cn(
                    "block w-full py-3.5 px-4 rounded-xl text-center text-sm font-semibold transition-all duration-300",
                    "bg-gradient-to-r from-purple-600 to-indigo-600 text-white",
                    "hover:scale-[1.02] hover:shadow-[0_0_20px_rgba(168,85,247,0.4)] hover:from-purple-500 hover:to-indigo-500"
                  )}
                >
                  Naruči sada
                </button>
              </motion.div>
            );
          })}
        </div>

        <motion.div 
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.8, duration: 0.8 }}
          className="mt-24 max-w-3xl mx-auto bg-white/[0.02] border border-white/[0.05] rounded-2xl p-8 backdrop-blur-xl"
        >
          <div className="flex flex-col md:flex-row gap-4 items-start">
            <AlertCircle size={24} className="text-purple-400 shrink-0 mt-1" />
            <div>
              <h4 className="text-lg font-semibold text-white mb-4">
                Važne Napomene
              </h4>
              <ul className="text-slate-400 text-sm space-y-3">
                {notes.map((note, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <span className="text-purple-500/50 mt-0.5">•</span>
                    <span>{note}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </motion.div>
      </div>
    </div>
  );
}

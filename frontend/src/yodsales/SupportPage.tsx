
import React, { useState } from 'react';
import { Card, Input, Button, Badge } from './UI';
import { ys } from '@/lib/yodsalesApi';

const SUPPORT_PHONE = (import.meta.env.VITE_SUPPORT_PHONE as string | undefined) || '';
const SUPPORT_EMAIL = (import.meta.env.VITE_SUPPORT_EMAIL as string | undefined) || 'yodsalesth@gmail.com';

interface SupportPageProps {
  language: 'EN' | 'TH';
  theme: string;
}

const SupportPage: React.FC<SupportPageProps> = ({ language, theme }) => {
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    subject: '',
    message: ''
  });
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const isDark = theme === 'Dark';

  const t = {
    title: language === 'EN' ? 'Support & Contact' : 'ช่วยเหลือและติดต่อ',
    subtitle: language === 'EN' ? 'Get expert help for your field operations.' : 'รับความช่วยเหลือจากผู้เชี่ยวชาญสำหรับการดำเนินงานภาคสนามของคุณ',
    formTitle: language === 'EN' ? 'Direct Message' : 'ข้อความโดยตรง',
    name: language === 'EN' ? 'Full Name' : 'ชื่อ-นามสกุล',
    email: language === 'EN' ? 'Email Address' : 'ที่อยู่อีเมล',
    subject: language === 'EN' ? 'Subject' : 'หัวข้อ',
    message: language === 'EN' ? 'Message' : 'ข้อความ',
    send: language === 'EN' ? 'Send Message' : 'ส่งข้อความ',
    successTitle: language === 'EN' ? 'Message Sent!' : 'ส่งข้อความแล้ว!',
    successDesc: language === 'EN' ? 'Our regional support lead will contact you shortly.' : 'หัวหน้าทีมสนับสนุนระดับภูมิภาคของเราจะติดต่อคุณในไม่ช้า',
    quickInfo: language === 'EN' ? 'Quick Support' : 'ข้อมูลสนับสนุนเบื้องต้น',
    hotline: language === 'EN' ? 'Sales Hotline' : 'สายด่วนฝ่ายขาย',
    emailSupport: language === 'EN' ? 'Technical Support' : 'สนับสนุนด้านเทคนิค',
    hqAddress: language === 'EN' ? 'Regional HQ' : 'สำนักงานใหญ่ระดับภูมิภาค',
    address: language === 'EN' ? 'Sukhumvit Road, Bangkok, Thailand' : 'ถนนสุขุมวิท, กรุงเทพฯ, ประเทศไทย',
    faq: language === 'EN' ? 'Common Questions' : 'คำถามที่พบบ่อย',
  };

  const [sendError, setSendError] = useState('');
  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    setSendError('');
    if (!formData.message.trim()) { setSendError(language === 'EN' ? 'Please write a message' : 'กรุณาพิมพ์ข้อความ'); return; }
    setLoading(true);
    try {
      await ys.support(formData);
      setSubmitted(true);
      setFormData({ name: '', email: '', subject: '', message: '' });
    } catch (err: any) {
      setSendError(err.message || 'Failed to send');
    } finally {
      setLoading(false);
    }
  };

  const InfoCard = ({ icon, label, value, subValue }: { icon: string, label: string, value: string, subValue?: string }) => (
    <div className={`p-6 rounded-[2rem] border transition-all ${isDark ? 'bg-slate-800 border-slate-700' : 'bg-white border-slate-100 shadow-sm'}`}>
      <div className="flex items-start gap-4">
        <div className={`w-12 h-12 rounded-2xl flex items-center justify-center text-xl shadow-inner ${isDark ? 'bg-slate-900' : 'bg-slate-50'}`}>
          {icon}
        </div>
        <div>
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">{label}</p>
          <p className={`text-sm font-black ${isDark ? 'text-white' : 'text-slate-800'}`}>{value}</p>
          {subValue && <p className="text-[10px] font-bold text-blue-500 mt-1">{subValue}</p>}
        </div>
      </div>
    </div>
  );

  return (
    <div className="max-w-7xl mx-auto space-y-10 animate-in fade-in slide-in-from-bottom-4 duration-700">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-6">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <span className="text-3xl">🎧</span>
          </div>
          <h2 className={`text-4xl font-black italic tracking-tighter [text-shadow:_0_1px_0_rgb(0_0_0_/_10%)] ${isDark ? 'text-white' : 'text-slate-900'}`}>
            {t.title}
          </h2>
          <p className="text-slate-400 text-sm font-bold uppercase tracking-widest mt-2">{t.subtitle}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-10">
        {/* Form Area */}
        <div className="lg:col-span-7">
          <Card title={t.formTitle} className={isDark ? 'bg-slate-900 border-slate-800' : 'shadow-2xl'}>
            {submitted ? (
              <div className="py-20 text-center space-y-4 animate-in zoom-in-95 duration-500">
                <div className="w-24 h-24 bg-emerald-50 text-emerald-600 rounded-full flex items-center justify-center text-4xl mx-auto shadow-inner">✓</div>
                <div className="space-y-1">
                  <h4 className="text-2xl font-black text-slate-900">{t.successTitle}</h4>
                  <p className="text-slate-500 font-medium max-w-xs mx-auto">{t.successDesc}</p>
                </div>
                <Button variant="secondary" size="md" onClick={() => setSubmitted(false)} className="mt-4">Send Another</Button>
              </div>
            ) : (
              <form onSubmit={handleSend} className="space-y-6">
                {sendError && <div className="p-3 rounded-xl bg-red-50 border border-red-100 text-red-600 text-xs font-bold">{sendError}</div>}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <Input 
                    label={t.name} 
                    placeholder="Worawee Thai" 
                    value={formData.name}
                    onChange={e => setFormData({...formData, name: e.target.value})}
                    required
                  />
                  <Input 
                    label={t.email} 
                    type="email" 
                    placeholder="worawee@gmail.com" 
                    value={formData.email}
                    onChange={e => setFormData({...formData, email: e.target.value})}
                    required
                  />
                </div>
                <Input 
                  label={t.subject} 
                  placeholder="Inquiry regarding Phase 3 rollout" 
                  value={formData.subject}
                  onChange={e => setFormData({...formData, subject: e.target.value})}
                  required
                />
                <div className="space-y-1">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] pl-2">{t.message}</label>
                  <textarea 
                    rows={5}
                    placeholder="How can we help your field team succeed?"
                    className={`w-full rounded-2xl px-5 py-4 text-sm font-bold shadow-[inset_0_2px_4px_rgba(0,0,0,0.05)] outline-none transition-all border-2 resize-none
                      ${isDark ? 'bg-slate-800 border-slate-700 text-white focus:border-blue-500/50' : 'bg-slate-50 border-slate-100 text-slate-700 focus:bg-white focus:border-blue-500/30'}
                    `}
                    value={formData.message}
                    onChange={e => setFormData({...formData, message: e.target.value})}
                    required
                  />
                </div>
                <Button type="submit" loading={loading} className="w-full py-5 text-base shadow-xl active:scale-95">
                  🚀 {t.send}
                </Button>
              </form>
            )}
          </Card>
        </div>

        {/* Info Area */}
        <div className="lg:col-span-5 space-y-6">
          <h4 className={`text-[10px] font-black uppercase tracking-[0.3em] pl-4 ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>
            {t.quickInfo}
          </h4>
          
          {SUPPORT_PHONE && <InfoCard icon="📞" label={t.hotline} value={SUPPORT_PHONE} />}
          
          <InfoCard 
            icon="✉️" 
            label={t.emailSupport} 
            value={SUPPORT_EMAIL} 
          />
          
          <InfoCard 
            icon="🏢" 
            label={t.hqAddress} 
            value={t.address} 
            subValue="Bangkok Innovation Hub" 
          />

          <div className={`p-8 rounded-[2.5rem] bg-gradient-to-br from-[#242A56] to-[#1E40AF] text-white shadow-xl relative overflow-hidden`}>
             <div className="absolute -right-4 -bottom-4 opacity-10 text-8xl pointer-events-none italic font-black">YOD</div>
             <h5 className="text-sm font-black uppercase tracking-widest mb-4 flex items-center gap-2">
               <span className="text-emerald-400">💡</span> {t.faq}
             </h5>
             <div className="space-y-4">
               {[
                 { q: language === 'EN' ? 'How to update territory leads?' : 'วิธีอัปเดตผู้มุ่งหวังในพื้นที่?', a: 'Visit Lead Discovery and scan your assigned province.' },
                 { q: language === 'EN' ? 'Is offline mode supported?' : 'รองรับโหมดออฟไลน์หรือไม่?', a: 'Yes, data syncs automatically once reconnected to LTE/5G.' }
               ].map((item, idx) => (
                 <div key={idx} className="border-b border-white/10 pb-4 last:border-0 last:pb-0">
                   <p className="text-xs font-black text-blue-200 mb-1">Q: {item.q}</p>
                   <p className="text-[11px] font-medium text-white/70">{item.a}</p>
                 </div>
               ))}
             </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SupportPage;

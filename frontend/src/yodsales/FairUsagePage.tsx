
import React from 'react';
import { Card, Badge } from './UI';

interface FairUsagePageProps {
  language: 'EN' | 'TH';
  theme: string;
}

const FairUsagePage: React.FC<FairUsagePageProps> = ({ language, theme }) => {
  const isDark = theme === 'Dark';

  const t = {
    title: language === 'EN' ? 'Data Governance & Fair Use' : 'ธรรมาภิบาลข้อมูลและนโยบายการใช้งาน',
    subtitle: language === 'EN' ? 'Strict compliance protocols for YodSales Pro Thailand operators.' : 'ระเบียบการปฏิบัติตามข้อกำหนดอย่างเคร่งครัดสำหรับผู้ปฏิบัติงาน YodSales Pro',
    lastUpdated: language === 'EN' ? 'REVISED: NOVEMBER 2026' : 'แก้ไขล่าสุด: พฤศจิกายน 2569',
    introTitle: language === 'EN' ? 'Compliance Mandate' : 'คำสั่งการปฏิบัติตามข้อกำหนด',
    introText: language === 'EN' 
      ? 'To safeguard the integrity of the YodSales network and maintain compliance with the Thailand PDPA (B.E. 2562) and Google Fair Usage Policies, all users must adhere to the following zero-tolerance restrictions.'
      : 'เพื่อปกป้องความสมบูรณ์ของเครือข่าย YodSales และรักษาการปฏิบัติตาม PDPA ของไทย (พ.ศ. 2562) และนโยบายการใช้งานที่ยุติธรรมของ Google ผู้ใช้ทุกคนต้องปฏิบัติตามข้อจำกัดที่เข้มงวดดังต่อไปนี้',
    sections: [
      {
        title: language === 'EN' ? '1. DATA EXTRACTION QUOTAS' : '1. โควตาการดึงข้อมูล',
        items: language === 'EN' 
          ? [
              'Bulk exporting is strictly capped at 25 leads per rolling 24-hour period.',
              'Managerial override is required for any export exceeding the 25-lead limit.',
              'Automated scraping or programmatic harvesting of the Lead Discovery database results in immediate account termination.'
            ]
          : [
              'การส่งออกข้อมูลถูกจำกัดอย่างเคร่งครัดที่ 25 รายชื่อต่อรอบ 24 ชั่วโมง',
              'ต้องได้รับการอนุมัติจากผู้จัดการสำหรับการส่งออกที่เกินขีดจำกัด 25 รายชื่อ',
              'การดึงข้อมูลอัตโนมัติหรือการเก็บข้อมูลด้วยโปรแกรมจากฐานข้อมูลจะส่งผลให้ถูกระงับบัญชีทันที'
            ]
      },
      {
        title: language === 'EN' ? '2. PDPA & GOOGLE COMPLIANCE' : '2. การปฏิบัติตาม PDPA และ GOOGLE',
        items: language === 'EN'
          ? [
              'AI-generated lead insights are for internal use only and must not be published externally.',
              'Processing of sensitive contact data must strictly follow Google Fair Usage Policy regarding automated outreach.',
              'Cross-border transfer of lead data without explicit authorization is a violation of regional governance.'
            ]
          : [
              'ข้อมูลเชิงลึกที่สร้างโดย AI มีไว้สำหรับใช้งานภายในเท่านั้น และห้ามเผยแพร่สู่ภายนอก',
              'การประมวลผลข้อมูลการติดต่อที่ละเอียดอ่อนต้องปฏิบัติตามนโยบายการใช้งานที่ยุติธรรมของ Google เกี่ยวกับการติดต่อสื่อสารอัตโนมัติ',
              'การโอนย้ายข้อมูลรายชื่อข้ามพรมแดนโดยไม่ได้รับอนุญาตถือเป็นการละเมิดธรรมาภิบาลระดับภูมิภาค'
            ]
      },
      {
        title: language === 'EN' ? '3. SECURITY & INTEGRITY' : '3. ความปลอดภัยและความสมบูรณ์',
        items: language === 'EN'
          ? [
              'Session monitoring is active; high-frequency "burst" queries will trigger a mandatory security audit.',
              'Account sharing is a critical security breach; geofencing is used to detect unauthorized access locations.',
              'Derived sales intelligence must be purged from personal devices within 30 days of discovery.'
            ]
          : [
              'มีการตรวจสอบเซสชันการใช้งาน; การค้นหาความถี่สูงจะกระตุ้นการตรวจสอบความปลอดภัยภาคบังคับ',
              'การแชร์บัญชีถือเป็นการละเมิดความปลอดภัยร้ายแรง; มีการใช้ Geofencing เพื่อตรวจจับการเข้าใช้งานจากสถานที่ที่ไม่ได้รับอนุญาต',
              'ข้อมูลอัจฉริยะด้านการขายต้องถูกลบออกจากอุปกรณ์ส่วนตัวภายใน 30 วันหลังจากที่ค้นพบ'
            ]
      }
    ],
    footer: language === 'EN' ? 'FAILURE TO COMPLY WILL RESULT IN PERMANENT REVOCATION OF CREDENTIALS.' : 'การไม่ปฏิบัติตามจะส่งผลให้มีการเพิกถอนสิทธิ์การใช้งานอย่างถาวร'
  };

  return (
    <div className="max-w-4xl mx-auto space-y-10 animate-in fade-in slide-in-from-bottom-4 duration-700 pb-20">
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <Badge variant="red" className="animate-pulse">{t.lastUpdated}</Badge>
          <span className="text-2xl">🛡️</span>
        </div>
        <h2 className={`text-4xl font-black italic tracking-tighter ${isDark ? 'text-white' : 'text-slate-900'}`}>
          {t.title}
        </h2>
        <p className={`text-sm font-black uppercase tracking-widest ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>{t.subtitle}</p>
      </div>

      <Card className={`${isDark ? 'bg-slate-900 border-slate-700' : 'border-slate-200'}`}>
        <div className="space-y-12">
          <section className="space-y-4">
            <h3 className="text-lg font-black uppercase tracking-tight flex items-center gap-3 text-red-600">
              <span className="w-1.5 h-6 bg-current rounded-full"></span>
              {t.introTitle}
            </h3>
            <p className={`text-sm leading-relaxed font-bold ${isDark ? 'text-slate-300' : 'text-slate-600'}`}>
              {t.introText}
            </p>
          </section>

          <div className="grid gap-12">
            {t.sections.map((section, idx) => (
              <section key={idx} className="space-y-4">
                <h4 className={`text-[10px] font-black uppercase tracking-[0.3em] ${isDark ? 'text-slate-400' : 'text-slate-400'}`}>
                  {section.title}
                </h4>
                <div className={`space-y-3 p-6 rounded-3xl border ${isDark ? 'bg-slate-800/50 border-slate-700' : 'bg-slate-50 border-slate-100'}`}>
                  {section.items.map((item, i) => (
                    <div key={i} className="flex items-start gap-4">
                      <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-red-600 shrink-0 shadow-[0_0_8px_rgba(220,38,38,0.5)]"></span>
                      <p className={`text-xs font-black leading-relaxed ${isDark ? 'text-slate-200' : 'text-slate-700'}`}>{item}</p>
                    </div>
                  ))}
                </div>
              </section>
            ))}
          </div>

          <div className="mt-12 p-8 rounded-[2rem] bg-slate-950 text-white flex flex-col md:flex-row items-center gap-6 border-t-4 border-red-600 shadow-2xl">
            <span className="text-4xl">🚫</span>
            <div className="space-y-1">
              <p className="text-[10px] font-black uppercase tracking-[0.4em] text-red-500">Notice of Enforcement</p>
              <p className="text-xs font-black leading-loose tracking-widest">
                {t.footer}
              </p>
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
};

export default FairUsagePage;

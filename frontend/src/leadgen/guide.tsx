import { useState } from 'react';
import Link from 'next/link';

// ─────────────────────────────────────────────────────────────────────────────
// Content — Thai and English completely separate
// ─────────────────────────────────────────────────────────────────────────────
const CONTENT = {
  th: {
    pageTitle:    'คู่มือการใช้งาน',
    pageSubtitle: 'วิธีหาผู้ติดต่อและส่งไปยัง HubSpot ทีละขั้นตอน',
    nav: ['ภาพรวม', 'Apify', 'Apollo Search', 'All Contacts', 'HubSpot', 'คำถามที่พบบ่อย'],

    overview: {
      title: 'แอปนี้ทำอะไร?',
      body: 'แอปนี้ช่วยคุณค้นหาผู้ติดต่อทางธุรกิจและส่งไปยัง HubSpot มีวิธีค้นหา 2 แบบ:',
      cards: [
        {
          icon: '🕷️', title: 'Apify',
          desc: 'ค้นหาธุรกิจท้องถิ่น เช่น ร้านอาหาร คลินิก ร้านค้า แอปจะดึงข้อมูลติดต่อให้อัตโนมัติ',
          best: 'เหมาะสำหรับ: ธุรกิจท้องถิ่น คลินิก ร้านค้า',
        },
        {
          icon: '🔬', title: 'Apollo Search',
          desc: 'ค้นหาในฐานข้อมูลธุรกิจขนาดใหญ่ เพื่อหาผู้บริหาร CEO เจ้าของ ตามสถานที่และอุตสาหกรรม',
          best: 'เหมาะสำหรับ: ผู้บริหาร B2B ธุรกิจเฉพาะทาง',
        },
      ],
      footer: 'หลังจากค้นหา ให้ Approve ผู้ติดต่อที่ต้องการ แล้ว Push ไปยัง HubSpot — เท่านั้นเอง!',
    },

    apify: {
      title: 'Apify',
      intro: 'ใช้สำหรับหาธุรกิจท้องถิ่น เช่น คลินิก ร้านอาหาร ร้านค้า',
      steps: [
        { en: 'ไปที่ "Lead Discovery" ในเมนูด้านซ้าย' },
        { en: 'พิมพ์สิ่งที่ต้องการค้นหา เช่น "คลินิก" หรือ "ร้านอาหารไทย"' },
        { en: 'ตั้งค่าสถานที่ (เมืองและประเทศ) แล้วกด Launch' },
        { en: 'รอสักครู่ ไปที่ "Search Jobs" เพื่อดูเมื่องานเสร็จ' },
        { en: 'เมื่อสถานะแสดงว่า Done — กด Review Leads เพื่อดูผลลัพธ์' },
        { en: 'Approve leads ที่ต้องการ ผู้ติดต่อจะถูกค้นหาอัตโนมัติและปรากฏใน All Contacts' },
      ],
    },

    apollo: {
      title: 'ค้นหาด้วย Apollo',
      intro: 'ใช้สำหรับหาบุคคลเฉพาะ เช่น CEO ของบริษัทในกรุงเทพฯ หรือเจ้าของโรงแรม',
      steps: [
        { en: 'ไปที่ "Apollo Search" ในเมนูด้านซ้าย' },
        { en: 'กรอกตัวกรอง: เมือง ประเทศ อุตสาหกรรม และระดับตำแหน่ง (Owner / CEO / Director)' },
        { en: 'ตั้งจำนวนผู้ติดต่อที่ต้องการด้วยตัวเลื่อน (50 ถึง 500 คน)' },
        { en: 'กด Search — แอปจะค้นหาและดึงอีเมล/เบอร์โทรอัตโนมัติ' },
        { en: 'ไปที่ "Apollo Dashboard" เพื่อดูงานค้นหาและผู้ติดต่อที่พบ' },
        { en: 'คลิกที่งานเพื่อดูผู้ติดต่อ Approve ที่ต้องการ แล้ว Push ไปยัง HubSpot' },
      ],
      note: 'การค้นหาใช้เวลา 2–5 นาที สถานะจะอัปเดตอัตโนมัติ ไม่ต้องรีเฟรชหน้า',
    },

    contacts: {
      title: 'All Contacts',
      intro: 'ที่นี่คือที่รวมผู้ติดต่อทั้งหมด — ทั้งจาก Google Maps และ Apollo',
      steps: [
        { en: 'ไปที่ "All Contacts" ในเมนูด้านซ้าย' },
        { en: 'ใช้ปุ่มกรองด้านบนเพื่อสลับระหว่าง All / Apollo / Apify' },
        { en: 'กรองตามสถานะได้ด้วย: Pending, Approved, Rejected, หรือ In HubSpot' },
        { en: 'กด Approve เพื่ออนุมัติ กด Reject เพื่อข้ามรายการนั้น' },
        { en: 'หลังจาก Approve แล้ว กด Push to HubSpot เพื่อส่งผู้ติดต่อ' },
        { en: 'ต้องการดาวน์โหลด? กด CSV เพื่อส่งออกเป็นไฟล์ Excel' },
      ],
    },

    hubspot: {
      title: 'การส่งไปยัง HubSpot',
      intro: 'เมื่อคุณ Push ผู้ติดต่อไปยัง HubSpot ข้อมูลทั้งหมดจะถูกส่งอัตโนมัติ — ชื่อ อีเมล เบอร์โทร ตำแหน่ง และบริษัท',
      steps: [
        { en: 'ตรวจสอบว่าผู้ติดต่อมีสถานะ Approved แล้ว' },
        { en: 'กดปุ่ม "Push to HubSpot" ข้างผู้ติดต่อ' },
        { en: 'ผู้ติดต่อจะปรากฏใน HubSpot CRM ภายในไม่กี่วินาที' },
        { en: 'ป้ายสถานะจะเปลี่ยนเป็น "In HubSpot" เพื่อยืนยันว่าส่งแล้ว' },
      ],
      note: 'ระบบตรวจสอบข้อมูลซ้ำอัตโนมัติ — หากผู้ติดต่ออยู่ใน HubSpot แล้ว จะไม่ถูกเพิ่มซ้ำ',
    },

    faq: {
      title: 'คำถามที่พบบ่อย',
      items: [
        {
          q: 'กด Search แล้วไม่มีอะไรเกิดขึ้น ต้องทำอย่างไร?',
          a: 'รอ 2–5 นาที การค้นหา Apollo ทำงานในเบื้องหลัง ไปที่ Apollo Dashboard เพื่อดูสถานะ หากยังแสดงว่า Running หลัง 10 นาที ให้กด Retry',
        },
        {
          q: 'ผู้ติดต่อไม่มีอีเมลหรือเบอร์โทร เพราะอะไร?',
          a: 'ผู้ติดต่อบางรายในฐานข้อมูลไม่มีข้อมูลสาธารณะ จะบันทึกเฉพาะรายที่มีอีเมลหรือเบอร์โทรอย่างน้อยหนึ่งอย่าง',
        },
        {
          q: 'ได้ผู้ติดต่อน้อยกว่าที่คาด เพราะอะไร?',
          a: 'ไม่ใช่ทุกสถานที่หรืออุตสาหกรรมจะมีข้อมูลจำนวนมาก ลองตั้งตัวเลื่อนให้สูงขึ้น (200–500) หรือเลือกอุตสาหกรรมที่กว้างขึ้น',
        },
        {
          q: 'Push ไปยัง HubSpot ไม่สำเร็จ ต้องทำอย่างไร?',
          a: 'ตรวจสอบว่าผู้ติดต่อมีสถานะ Approved ก่อน แล้วลอง Push ใหม่อีกครั้ง หากยังไม่สำเร็จ ให้แจ้งทีมงาน',
        },
        {
          q: 'ใช้ Apify และ Apollo พร้อมกันได้ไหม?',
          a: 'ได้เลย! สามารถรันทั้งสองพร้อมกัน ผลลัพธ์ทั้งหมดจะปรากฏรวมกันใน All Contacts แบ่งกลุ่มชัดเจนตามแหล่งที่มา',
        },
        {
          q: 'Reject แล้วเปลี่ยนใจได้ไหม?',
          a: 'ได้ กด Approve ที่รายการเดิมได้ตลอดเวลา การ Reject ไม่ได้ลบข้อมูล',
        },
        {
          q: 'จะดาวน์โหลดผู้ติดต่อเป็น Excel ได้อย่างไร?',
          a: 'ไปที่ All Contacts ตั้งค่าตัวกรองที่ต้องการ แล้วกดปุ่ม CSV ด้านบน ไฟล์จะดาวน์โหลดอัตโนมัติ',
        },
        {
          q: 'งาน Apify เสร็จแล้วแต่ไม่เห็นผู้ติดต่อ เพราะอะไร?',
          a: 'ไปที่ Dashboard กด Review Leads จากนั้น Approve leads บางส่วนก่อน ผู้ติดต่อจะถูกค้นหาหลังจากที่คุณ Approve เท่านั้น',
        },
      ],
    },

    links: { title: 'ลิงก์ด่วน' },
  },

  en: {
    pageTitle:    'User Guide',
    pageSubtitle: 'How to find contacts and send them to HubSpot — step by step.',
    nav: ['Overview', 'Apify', 'Apollo Search', 'All Contacts', 'HubSpot', 'FAQ'],

    overview: {
      title: 'What does this app do?',
      body: 'This app helps you find business contacts and send them directly to HubSpot. There are two ways to search:',
      cards: [
        {
          icon: '🕷️', title: 'Apify',
          desc: 'Search for local businesses like restaurants, clinics, or shops. The app finds their contact details automatically.',
          best: 'Best for: local businesses, clinics, retail shops',
        },
        {
          icon: '🔬', title: 'Apollo Search',
          desc: 'Search a large business database to find decision-makers — CEO, Director, Owner — at specific companies by location and industry.',
          best: 'Best for: executives, B2B contacts, specific industries',
        },
      ],
      footer: 'After searching, Approve the contacts you want and Push them to HubSpot — that\'s it!',
    },

    apify: {
      title: 'Apify',
      intro: 'Use this to find local businesses — clinics, restaurants, retail shops, and more.',
      steps: [
        { en: 'Go to "Lead Discovery" in the left menu.' },
        { en: 'Type what you want to search — for example "dental clinic" or "thai restaurant".' },
        { en: 'Set the location (city and country), then click Launch.' },
        { en: 'Wait a few minutes. Go to "Search Jobs" to see when it finishes.' },
        { en: 'When the status shows Done — click Review Leads to see all results.' },
        { en: 'Approve the leads you want. Contacts are found automatically and appear in All Contacts.' },
      ],
    },

    apollo: {
      title: 'Apollo Search',
      intro: 'Use this to find specific people — like the CEO of a medical company in Bangkok, or the owner of a hotel chain.',
      steps: [
        { en: 'Go to "Apollo Search" in the left menu.' },
        { en: 'Fill in the filters: City, Country, Industry, and Job Level (Owner / CEO / Director).' },
        { en: 'Set how many contacts you want using the slider (50 to 500).' },
        { en: 'Click Search — the app will find contacts and collect their email and phone automatically.' },
        { en: 'Go to "Apollo Dashboard" to see your search runs and the contacts found.' },
        { en: 'Click on a run to see contacts. Approve the ones you want, then push to HubSpot.' },
      ],
      note: 'The search takes 2–5 minutes. The status updates automatically — no need to refresh.',
    },

    contacts: {
      title: 'All Contacts',
      intro: 'This is where all your contacts live — from both Google Maps and Apollo searches together.',
      steps: [
        { en: 'Go to "All Contacts" in the left menu.' },
        { en: 'Use the filter buttons at the top to switch between All / Apollo / Apify contacts.' },
        { en: 'You can also filter by status: Pending, Approved, Rejected, or In HubSpot.' },
        { en: 'Click Approve on a contact to approve it. Click Reject to skip it.' },
        { en: 'After approving, click Push to HubSpot to send the contact.' },
        { en: 'Want to download contacts? Click the CSV button to export them to Excel.' },
      ],
    },

    hubspot: {
      title: 'Sending to HubSpot',
      intro: 'When you push a contact to HubSpot, their full details are sent automatically — name, email, phone, job title, and company.',
      steps: [
        { en: 'Make sure the contact is Approved.' },
        { en: 'Click the "Push to HubSpot" button next to the contact.' },
        { en: 'The contact will appear in your HubSpot CRM within a few seconds.' },
        { en: 'The badge changes to "In HubSpot" to confirm it was sent.' },
      ],
      note: 'The app automatically checks for duplicates — if the contact is already in HubSpot, it won\'t be added twice.',
    },

    faq: {
      title: 'Frequently Asked Questions',
      items: [
        {
          q: 'I clicked Search but nothing happened. What do I do?',
          a: 'Wait 2–5 minutes. Apollo search runs in the background. Go to Apollo Dashboard to check status. If still Running after 10 minutes, click Retry.',
        },
        {
          q: 'The contact has no email or phone. Why?',
          a: 'Some contacts in the database don\'t have publicly available email or phone. Only contacts with at least an email or phone are saved.',
        },
        {
          q: 'I got fewer contacts than expected. Why?',
          a: 'Not every location or industry has many contacts in the database. Try setting the slider higher (200–500), or choose a broader industry.',
        },
        {
          q: 'Push to HubSpot failed. What should I do?',
          a: 'Make sure the contact is Approved first, then try pushing again. If it keeps failing, contact your system administrator.',
        },
        {
          q: 'Can I run Apify and Apollo at the same time?',
          a: 'Yes! You can run both at the same time. All results appear together in All Contacts, clearly grouped by source.',
        },
        {
          q: 'What does Reject do? Can I undo it?',
          a: 'Reject marks the contact as skipped. You can undo it anytime by clicking Approve on the same contact. No data is deleted.',
        },
        {
          q: 'How do I download contacts to Excel?',
          a: 'Go to All Contacts, set any filters you want, then click the CSV button at the top. The file downloads automatically.',
        },
        {
          q: 'The Apify job finished but I see no contacts. Why?',
          a: 'Go to Dashboard, find your job, and click Review Leads. Approve some leads first — contacts are only found after you approve leads.',
        },
      ],
    },

    links: { title: 'Quick Links' },
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Small components
// ─────────────────────────────────────────────────────────────────────────────
const NAV_IDS = ['overview', 'apify', 'apollo', 'contacts', 'hubspot', 'faq'];

function StepList({ steps }: { steps: { en: string }[] }) {
  return (
    <div className="space-y-2">
      {steps.map((s, i) => (
        <div key={i} className="flex gap-2.5 items-start">
          <div className="w-6 h-6 rounded-lg text-white text-xs font-bold flex items-center justify-center flex-shrink-0 mt-0.5"
               style={{ background: 'linear-gradient(135deg,#242A56,#3b4a8c)', boxShadow: '0 2px 6px rgb(36 42 86/.25)' }}>
            {i + 1}
          </div>
          <p className="text-sm text-gray-700 pt-0.5">{s.en}</p>
        </div>
      ))}
    </div>
  );
}

function Section({ id, icon, title, children }: {
  id: string; icon: string; title: string; children: React.ReactNode;
}) {
  return (
    <section id={id} className="mb-6">
      <h2 className="text-sm font-bold text-gray-900 flex items-center gap-2 mb-3 pb-2"
          style={{ borderBottom: '1px solid #f1f5f9' }}>
        <span className="text-base">{icon}</span>{title}
      </h2>
      <div className="space-y-3 text-sm text-gray-600 leading-relaxed">{children}</div>
    </section>
  );
}

function NoteBox({ text }: { text: string }) {
  return (
    <div className="rounded-lg px-3 py-2.5 text-sm" style={{ background: '#eef2ff', border: '1px solid #c7d2fe' }}>
      <p className="text-indigo-800">💡 {text}</p>
    </div>
  );
}

function WarnBox({ text }: { text: string }) {
  return (
    <div className="rounded-lg px-3 py-2.5 text-sm" style={{ background: '#fffbeb', border: '1px solid #fde68a' }}>
      <p className="text-amber-800">⚠️ {text}</p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────────────────────
export default function GuidePage() {
  const [lang, setLang] = useState<'th' | 'en'>('th');
  const c = CONTENT[lang];

  return (
    <div className="max-w-3xl animate-fade-in">

      {/* ── Header + Language toggle ─────────────────────────────────────────── */}
      <div className="flex items-start justify-between mb-4 gap-4">
        <div>
          <h1 className="text-xl font-bold text-gray-900 tracking-tight mb-0.5">{c.pageTitle}</h1>
          <p className="text-gray-400 text-sm">{c.pageSubtitle}</p>
        </div>
        {/* Toggle */}
        <div className="flex-shrink-0 flex items-center gap-1 p-1 rounded-xl"
             style={{ background: '#f1f5f9', border: '1px solid #e2e8f0' }}>
          {(['th', 'en'] as const).map(l => (
            <button key={l} onClick={() => setLang(l)}
              className="px-4 py-1.5 rounded-lg text-sm font-bold transition-all whitespace-nowrap"
              style={lang === l
                ? { background: 'linear-gradient(135deg,#242A56,#3b4a8c)', color: '#fff', boxShadow: '0 2px 6px rgb(36 42 86/.3)' }
                : { color: '#94a3b8' }}>
              {l === 'th' ? 'ภาษาไทย' : 'English'}
            </button>
          ))}
        </div>
      </div>

      {/* ── Nav pills ─────────────────────────────────────────────────────────── */}
      <div className="card p-3 mb-4 flex flex-wrap gap-1.5">
        {c.nav.map((label, i) => (
          <a key={i} href={`#${NAV_IDS[i]}`}
             className="text-xs font-semibold px-3 py-1.5 rounded-full transition-colors"
             style={{ background: '#eef2ff', color: '#242A56', border: '1px solid #c7d2fe' }}>
            {label}
          </a>
        ))}
      </div>

      {/* ── Overview ─────────────────────────────────────────────────────────── */}
      <Section id="overview" icon="🗺️" title={c.overview.title}>
        <p>{c.overview.body}</p>
        <div className="grid sm:grid-cols-2 gap-3 mt-1">
          {c.overview.cards.map(card => (
            <div key={card.title} className="rounded-lg p-3"
                 style={{ background: card.icon === '🕷️' ? '#fff7ed' : '#eef2ff',
                          border: card.icon === '🕷️' ? '1px solid #fed7aa' : '1px solid #c7d2fe' }}>
              <p className="font-bold text-sm mb-1"
                 style={{ color: card.icon === '🕷️' ? '#92400e' : '#3730a3' }}>
                {card.icon} {card.title}
              </p>
              <p className="text-xs leading-relaxed"
                 style={{ color: card.icon === '🕷️' ? '#b45309' : '#4338ca' }}>
                {card.desc}
              </p>
              <p className="text-xs mt-1.5 font-semibold"
                 style={{ color: card.icon === '🕷️' ? '#d97706' : '#47549a' }}>
                {card.best}
              </p>
            </div>
          ))}
        </div>
        <p className="text-sm text-gray-700">{c.overview.footer}</p>
      </Section>

      {/* ── Apify ────────────────────────────────────────────────────────────── */}
      <Section id="apify" icon="🕷️" title={c.apify.title}>
        <p>{c.apify.intro}</p>
        <StepList steps={c.apify.steps} />
      </Section>

      {/* ── Apollo ───────────────────────────────────────────────────────────── */}
      <Section id="apollo" icon="🔬" title={c.apollo.title}>
        <p>{c.apollo.intro}</p>
        <StepList steps={c.apollo.steps} />
        <WarnBox text={c.apollo.note} />
      </Section>

      {/* ── All Contacts ─────────────────────────────────────────────────────── */}
      <Section id="contacts" icon="👥" title={c.contacts.title}>
        <p>{c.contacts.intro}</p>
        <StepList steps={c.contacts.steps} />
      </Section>

      {/* ── HubSpot ──────────────────────────────────────────────────────────── */}
      <Section id="hubspot" icon="🚀" title={c.hubspot.title}>
        <p>{c.hubspot.intro}</p>
        <StepList steps={c.hubspot.steps} />
        <NoteBox text={c.hubspot.note} />
      </Section>

      {/* ── FAQ ──────────────────────────────────────────────────────────────── */}
      <Section id="faq" icon="❓" title={c.faq.title}>
        <div className="space-y-2">
          {c.faq.items.map((item, i) => (
            <div key={i} className="rounded-lg p-3" style={{ background: '#fafafa', border: '1px solid #f1f5f9' }}>
              <p className="font-semibold text-gray-800 text-sm">❓ {item.q}</p>
              <p className="text-gray-500 text-sm mt-1">{item.a}</p>
            </div>
          ))}
        </div>
      </Section>

      {/* ── Quick links ──────────────────────────────────────────────────────── */}
      <div className="card p-3">
        <p className="font-bold text-gray-700 text-sm mb-2">{c.links.title}</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
          {[
            ['/',                '🕷️ Lead Discovery'],
            ['/dashboard',       '📊 Search Jobs'],
            ['/apollo',          '🔬 Apollo Search'],
            ['/contacts/apollo', '🔬 Apollo Dashboard'],
            ['/contacts/all',    '👥 All Contacts'],
          ].map(([href, label]) => (
            <Link key={href as string} href={href as string}
              className="bg-gray-50 hover:bg-indigo-50 border border-gray-100 hover:border-indigo-200 rounded-lg px-3 py-2 text-xs text-center text-gray-600 hover:text-indigo-700 transition-all font-semibold">
              {label}
            </Link>
          ))}
        </div>
      </div>

    </div>
  );
}

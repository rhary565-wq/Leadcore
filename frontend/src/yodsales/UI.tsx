
import React from 'react';

// --- BUTTON ---
interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'success' | 'danger' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
}

export const Button: React.FC<ButtonProps> = ({ 
  children, variant = 'primary', size = 'md', loading, className = '', ...props 
}) => {
  const base = "inline-flex items-center justify-center font-black uppercase tracking-widest rounded-[1.25rem] transition-all active:translate-y-1 active:shadow-none disabled:opacity-50 disabled:pointer-events-none";
  const variants = {
    primary: "bg-[#242A56] text-white hover:bg-[#1b2042] shadow-[0_6px_0_rgb(17,20,43)] border-b-2 border-transparent active:shadow-none active:border-b-0",
    secondary: "bg-white border-2 border-slate-200 text-slate-700 hover:bg-slate-50 shadow-[0_4px_0_rgb(226,232,240)] active:shadow-none",
    success: "bg-[#059669] text-white hover:bg-emerald-700 shadow-[0_6px_0_rgb(6,78,59)] active:shadow-none",
    danger: "bg-[#DC2626] text-white hover:bg-red-700 shadow-[0_6px_0_rgb(127,29,29)] active:shadow-none",
    ghost: "text-slate-500 hover:bg-slate-100",
  };
  const sizes = {
    sm: "px-4 py-2 text-[10px]",
    md: "px-6 py-3 text-xs",
    lg: "px-10 py-5 text-sm",
  };

  return (
    <button className={`${base} ${variants[variant]} ${sizes[size]} ${className}`} {...props}>
      {loading && <span className="mr-3 w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></span>}
      {children}
    </button>
  );
};

// --- INPUT ---
interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
}

export const Input: React.FC<InputProps> = ({ label, error, className = '', ...props }) => {
  return (
    <div className="space-y-1 w-full">
      {label && <label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] pl-2">{label}</label>}
      <div className="relative group">
        <input 
          className={`w-full bg-slate-50 border-2 ${error ? 'border-red-500' : 'border-slate-100'} rounded-2xl px-5 py-4 text-sm font-bold text-slate-700 shadow-[inset_0_2px_4px_rgba(0,0,0,0.05)] group-focus-within:bg-white group-focus-within:border-blue-500/30 group-focus-within:shadow-xl outline-none transition-all ${className}`}
          {...props}
        />
        <div className="absolute inset-0 rounded-2xl ring-4 ring-blue-500/0 group-focus-within:ring-blue-500/5 transition-all pointer-events-none"></div>
      </div>
      {error && <p className="text-[10px] text-red-500 font-black tracking-widest pl-2 uppercase">{error}</p>}
    </div>
  );
};

// --- CHECKBOX ---
export const Checkbox: React.FC<{ label: string, checked: boolean, onChange: (val: boolean) => void }> = ({ label, checked, onChange }) => (
  <label className="flex items-center gap-3 cursor-pointer group">
    <div 
      onClick={() => onChange(!checked)}
      className={`w-6 h-6 rounded-lg border-2 flex items-center justify-center transition-all ${checked ? 'bg-[#1E40AF] border-[#1E40AF] shadow-lg scale-110' : 'bg-white border-slate-200 group-hover:border-blue-400 shadow-sm'}`}
    >
      {checked && <span className="text-white text-sm font-black">✓</span>}
    </div>
    <span className="text-xs text-slate-600 font-black uppercase tracking-widest">{label}</span>
  </label>
);

// --- SWITCH ---
export const Switch: React.FC<{ label: string, checked: boolean, onChange: (val: boolean) => void }> = ({ label, checked, onChange }) => (
  <div className="flex items-center justify-between py-2">
    <span className="text-xs text-slate-500 font-black uppercase tracking-widest">{label}</span>
    <div 
      onClick={() => onChange(!checked)}
      className={`w-14 h-8 rounded-full p-1 cursor-pointer transition-all duration-300 ease-in-out shadow-inner ${checked ? 'bg-blue-600 shadow-[inset_0_2px_4px_rgba(0,0,0,0.2)]' : 'bg-slate-200'}`}
    >
      <div className={`w-6 h-6 bg-white rounded-full shadow-lg transform transition-transform duration-300 ${checked ? 'translate-x-6' : 'translate-x-0'}`} />
    </div>
  </div>
);

// --- CARD ---
export const Card: React.FC<{ children: React.ReactNode, title?: string, footer?: React.ReactNode, className?: string, allowOverflow?: boolean }> = ({ 
  children, title, footer, className = '', allowOverflow = false 
}) => {
  return (
    <div className={`bg-white rounded-[2.5rem] shadow-[0_20px_40px_-15px_rgba(0,0,0,0.05)] border border-slate-100 group hover:shadow-2xl transition-all duration-500 ${allowOverflow ? '' : 'overflow-hidden'} ${className}`}>
      {title && <div className={`px-6 md:px-10 py-6 border-b border-slate-50 font-black text-slate-800 uppercase tracking-tight text-sm flex items-center gap-4 bg-slate-50/20 ${allowOverflow ? 'rounded-t-[2.5rem]' : ''}`}>
        <div className="w-1.5 h-6 bg-[#ED1C24] rounded-full shadow-[0_0_12px_rgba(237,28,36,0.35)]"></div>
        {title}
      </div>}
      <div className={`p-6 md:p-10 ${allowOverflow ? '' : 'overflow-hidden'}`}>{children}</div>
      {footer && <div className={`px-6 md:px-10 py-6 bg-slate-50/50 border-t border-slate-50 ${allowOverflow ? 'rounded-b-[2.5rem]' : ''}`}>{footer}</div>}
    </div>
  );
};

// --- BADGE ---
export const Badge: React.FC<{ children: React.ReactNode, variant?: 'neutral' | 'blue' | 'green' | 'red' | 'orange', className?: string }> = ({ 
  children, variant = 'neutral', className = ''
}) => {
  const styles = {
    neutral: "bg-slate-100 text-slate-600 border-slate-200 shadow-sm",
    blue: "bg-blue-50 text-blue-700 border-blue-100 shadow-sm",
    green: "bg-emerald-50 text-emerald-700 border-emerald-100 shadow-sm",
    red: "bg-red-50 text-red-700 border-red-100 shadow-sm",
    orange: "bg-orange-50 text-orange-700 border-orange-100 shadow-sm",
  };
  return (
    <span className={`px-4 py-1.5 rounded-2xl text-[10px] font-black uppercase border tracking-widest ${styles[variant]} ${className}`}>
      {children}
    </span>
  );
};

// --- MODAL ---
export const Modal: React.FC<{ isOpen: boolean, onClose: () => void, title: string, children: React.ReactNode }> = ({ 
  isOpen, onClose, title, children 
}) => {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 md:p-6 overflow-y-auto">
      <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xl" onClick={onClose} />
      <div className="bg-white rounded-[3rem] shadow-[0_50px_100px_-20px_rgba(0,0,0,0.3)] w-full max-w-2xl relative z-10 animate-in zoom-in-95 fade-in duration-500 overflow-hidden border border-white/50">
        <div className="p-8 md:p-10 border-b border-slate-50 flex justify-between items-center bg-slate-50/30">
          <h3 className="text-2xl font-black text-slate-900 tracking-tight leading-none">{title}</h3>
          <button onClick={onClose} className="w-12 h-12 flex items-center justify-center bg-white hover:bg-slate-100 rounded-2xl text-slate-400 transition-all shadow-sm border border-slate-100 active:scale-90">✕</button>
        </div>
        <div className="p-8 md:p-12 overflow-y-auto max-h-[80vh]">{children}</div>
      </div>
    </div>
  );
};

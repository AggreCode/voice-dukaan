/** The handful of pictures the app uses, drawn once so every screen uses the same ones. */
type P = { className?: string };
const base = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.9, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };

export const MicIcon = ({ className }: P) => (
  <svg className={className} viewBox="0 0 24 24" {...base}><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3M9 21h6" /></svg>
);
export const CameraIcon = ({ className }: P) => (
  <svg className={className} viewBox="0 0 24 24" {...base}><path d="M3 8.5A2.5 2.5 0 0 1 5.5 6h1.2a2 2 0 0 0 1.7-1l.5-.8a1 1 0 0 1 .85-.5h4.5a1 1 0 0 1 .85.5l.5.8a2 2 0 0 0 1.7 1h1.2A2.5 2.5 0 0 1 21 8.5v9A2.5 2.5 0 0 1 18.5 20h-13A2.5 2.5 0 0 1 3 17.5v-9z" /><circle cx="12" cy="13" r="3.5" /></svg>
);
export const PenIcon = ({ className }: P) => (
  <svg className={className} viewBox="0 0 24 24" {...base}><path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4z" /><path d="M13.5 6.5l4 4" /></svg>
);
export const BagIcon = ({ className }: P) => (
  <svg className={className} viewBox="0 0 24 24" {...base}><path d="M6 8h12l-1 12H7L6 8z" /><path d="M9 8V6a3 3 0 0 1 6 0v2" /><path d="M10 13.5h4M12 11.5v4" /></svg>
);
export const TruckIcon = ({ className }: P) => (
  <svg className={className} viewBox="0 0 24 24" {...base}><path d="M2.5 6.5h11v9h-11zM13.5 9.5h4l3 3v3h-7z" /><circle cx="6.5" cy="17.5" r="1.8" /><circle cx="17" cy="17.5" r="1.8" /></svg>
);
export const BoxIcon = ({ className }: P) => (
  <svg className={className} viewBox="0 0 24 24" {...base}><path d="M21 8l-9-5-9 5v8l9 5 9-5V8zM3 8l9 5 9-5M12 13v8" /></svg>
);
export const ChartIcon = ({ className }: P) => (
  <svg className={className} viewBox="0 0 24 24" {...base}><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></svg>
);
export const HomeIcon = ({ className }: P) => (
  <svg className={className} viewBox="0 0 24 24" {...base}><path d="M4 9h16l-1.4-3a2 2 0 0 0-1.8-1.1H7.2A2 2 0 0 0 5.4 6L4 9z" /><path d="M5.5 10.5V19a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1v-8.5M10 20v-5.5a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1V20" /></svg>
);
export const MoreIcon = ({ className }: P) => (
  <svg className={className} viewBox="0 0 24 24" {...base}><circle cx="5" cy="12" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="19" cy="12" r="1.6" /></svg>
);
export const ListIcon = ({ className }: P) => (
  <svg className={className} viewBox="0 0 24 24" {...base}><path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01" /></svg>
);
export const TrashIcon = ({ className }: P) => (
  <svg className={className} viewBox="0 0 24 24" {...base}><path d="M4 7h16M9 7V4.5h6V7M6.5 7l1 13h9l1-13M10 11v6M14 11v6" /></svg>
);
export const CheckIcon = ({ className }: P) => (
  <svg className={className} viewBox="0 0 24 24" {...base} strokeWidth={2.6}><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
);
export const PlusIcon = ({ className }: P) => (
  <svg className={className} viewBox="0 0 24 24" {...base} strokeWidth={2.4}><path d="M12 5v14M5 12h14" /></svg>
);

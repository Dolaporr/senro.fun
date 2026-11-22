import React from 'react';
// The Nush mark: a lowercase n drawn as one arc, with a seed above its shoulder. One shape, the
// site's lime, sized by its parent. The same geometry is in public/favicon.svg and public/brand/.
export const NUSH_MARK_PATH='M7 27V15.5a9 9 0 0 1 18 0V27';
export function NushMark({className}){
 return <svg className={className} viewBox="0 0 32 32" fill="none" aria-hidden="true"><path d={NUSH_MARK_PATH} stroke="currentColor" strokeWidth="4.2" strokeLinecap="round"/><circle cx="25.5" cy="5.5" r="2.9" fill="currentColor"/></svg>;
}

import {redirect} from 'next/navigation';

/**
 * The Board and Hires views were merged into one specialist workspace at
 * `/specialist` (KPIs → kanban board → hire × team matrix). This route is kept
 * as a redirect so existing links (home "All hires", the hire-detail back nav)
 * still land in the right place.
 */
export default function SpecialistHiresRedirect() {
  redirect('/specialist');
}

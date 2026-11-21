import { VISUAL_EXAMPLE_PROJECTS } from '../data/visualExamples';
import { isSupabaseConfigured } from '../integrations/supabaseClient';
import { GovernmentProject } from '../types/database';

/**
 * Official Government & New Cities Projects Service (Phase 1)
 * Kept strictly separate from private user property advertisements.
 */
export function getGovernmentProjects(): GovernmentProject[] {
  if (isSupabaseConfigured) {
    return [];
  }
  return VISUAL_EXAMPLE_PROJECTS;
}

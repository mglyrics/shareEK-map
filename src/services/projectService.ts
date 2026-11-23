import { VISUAL_EXAMPLE_PROJECTS } from '../data/visualExamples';
import { isSupabaseConfigured, supabase } from '../integrations/supabase/client';
import type { GovernmentProject, ProjectStatus } from '../types/database';
import { isSchemaMissingError } from '../utils/formatters';
import { getSignedUrlsBatch } from './storageService';

export interface ProjectsQueryResult {
  items: GovernmentProject[];
  schemaMissing: boolean;
  usingVisualExamples: boolean;
  error: string | null;
}

/**
 * Official Government & New Cities Projects Service
 * Strictly separated from private user property advertisements.
 */
export async function getGovernmentProjects(): Promise<ProjectsQueryResult> {
  if (!isSupabaseConfigured || !supabase) {
    return {
      items: VISUAL_EXAMPLE_PROJECTS,
      schemaMissing: false,
      usingVisualExamples: true,
      error: null,
    };
  }

  const { data: rows, error } = await supabase
    .from('projects')
    .select('*')
    .eq('is_official_verified', true)
    .order('announcement_date', { ascending: false });

  if (error) {
    return {
      items: [],
      schemaMissing: isSchemaMissingError(error),
      usingVisualExamples: false,
      error: isSchemaMissingError(error) ? null : error.message,
    };
  }

  if (!rows || rows.length === 0) {
    return {
      items: [],
      schemaMissing: false,
      usingVisualExamples: false,
      error: null,
    };
  }

  const locationIds = Array.from(
    new Set(
      rows
        .flatMap((r) => [r.governorate_id, r.city_id])
        .filter((id): id is string => Boolean(id))
    )
  );

  const locationMap: Record<string, string> = {};
  if (locationIds.length > 0) {
    const { data: locs } = await supabase
      .from('locations')
      .select('id, name_ar')
      .in('id', locationIds);
    for (const loc of locs ?? []) {
      locationMap[loc.id] = loc.name_ar;
    }
  }

  const coverPaths = rows
    .map((r) => r.cover_image_path)
    .filter((p): p is string => Boolean(p));
  const signedCovers = await getSignedUrlsBatch('property-images', coverPaths);

  const items: GovernmentProject[] = rows.map((row) => ({
    id: row.id,
    authority: row.authority,
    projectName: row.project_name,
    projectCategory: row.project_category,
    governorateId: row.governorate_id,
    cityId: row.city_id,
    governorateName: locationMap[row.governorate_id] ?? 'مصر',
    cityName: row.city_id ? locationMap[row.city_id] ?? 'مدينة جديدة' : 'على مستوى الجمهورية',
    announcementReference: row.announcement_reference,
    announcementDate: row.announcement_date,
    officialSourceUrl: row.official_source_url,
    description: row.description,
    status: row.status as ProjectStatus,
    coverImagePath: row.cover_image_path,
    coverImageUrl:
      (row.cover_image_path ? signedCovers[row.cover_image_path] : '') ||
      '/src/assets/images/project_new_capital_1795256253929.jpg',
    isOfficialVerified: row.is_official_verified,
  }));

  return {
    items,
    schemaMissing: false,
    usingVisualExamples: false,
    error: null,
  };
}

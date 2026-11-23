import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { isSupabaseConfigured, supabase } from '../integrations/supabase/client';

const STORAGE_KEY = 'shareek_preview_favorites';

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function useFavorites() {
  const { isAuthenticated, user } = useAuth();
  const [favoriteIds, setFavoriteIds] = useState<string[]>(() => {
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        return Array.isArray(parsed) ? parsed : [];
      }
    } catch {
      // Ignore storage access errors in restricted frames
    }
    return [];
  });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!isSupabaseConfigured || !supabase || !isAuthenticated || !user) {
      return;
    }

    let active = true;
    setLoading(true);
    supabase
      .from('favorites')
      .select('property_id')
      .eq('user_id', user.id)
      .then(({ data, error }) => {
        if (!active) return;
        if (!error && data) {
          setFavoriteIds(data.map((r) => r.property_id));
        }
        setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [isAuthenticated, user]);

  useEffect(() => {
    if (isAuthenticated && user) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(favoriteIds));
    } catch {
      // Ignore storage write errors
    }
  }, [favoriteIds, isAuthenticated, user]);

  const isFavorite = useCallback(
    (propertyId: string) => favoriteIds.includes(propertyId),
    [favoriteIds]
  );

  const toggleFavorite = useCallback(
    async (propertyId: string) => {
      const currentlyFav = favoriteIds.includes(propertyId);
      setFavoriteIds((prev) =>
        currentlyFav ? prev.filter((id) => id !== propertyId) : [...prev, propertyId]
      );

      if (isSupabaseConfigured && supabase && isAuthenticated && user && UUID_REGEX.test(propertyId)) {
        if (currentlyFav) {
          const { error } = await supabase
            .from('favorites')
            .delete()
            .eq('user_id', user.id)
            .eq('property_id', propertyId);
          if (error) {
            setFavoriteIds((prev) => (prev.includes(propertyId) ? prev : [...prev, propertyId]));
          }
        } else {
          const { error } = await supabase.from('favorites').insert({
            user_id: user.id,
            property_id: propertyId,
          });
          if (error && error.code !== '23505') {
            setFavoriteIds((prev) => prev.filter((id) => id !== propertyId));
          }
        }
      }
    },
    [favoriteIds, isAuthenticated, user]
  );

  const clearFavorites = useCallback(async () => {
    const previous = favoriteIds;
    setFavoriteIds([]);
    if (isSupabaseConfigured && supabase && isAuthenticated && user) {
      const { error } = await supabase.from('favorites').delete().eq('user_id', user.id);
      if (error) {
        setFavoriteIds(previous);
      }
    }
  }, [favoriteIds, isAuthenticated, user]);

  return {
    favoriteIds,
    loading,
    isFavorite,
    toggleFavorite,
    clearFavorites,
  };
}

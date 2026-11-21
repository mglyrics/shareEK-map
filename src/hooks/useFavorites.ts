import { useCallback, useEffect, useState } from 'react';

const STORAGE_KEY = 'shareek_preview_favorites';

export function useFavorites() {
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

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(favoriteIds));
    } catch {
      // Ignore storage write errors
    }
  }, [favoriteIds]);

  const isFavorite = useCallback(
    (propertyId: string) => favoriteIds.includes(propertyId),
    [favoriteIds]
  );

  const toggleFavorite = useCallback((propertyId: string) => {
    setFavoriteIds((prev) =>
      prev.includes(propertyId)
        ? prev.filter((id) => id !== propertyId)
        : [...prev, propertyId]
    );
  }, []);

  const clearFavorites = useCallback(() => {
    setFavoriteIds([]);
  }, []);

  return {
    favoriteIds,
    isFavorite,
    toggleFavorite,
    clearFavorites,
  };
}

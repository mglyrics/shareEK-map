-- ShareEK - شريك العقاري
-- Migration 0006: Seed All 27 Egyptian Governorates, Major Cities, New Urban Communities, and Default Site Settings
-- NOTE: No unverified government projects are seeded here.

-- 1. Seed all 27 Egyptian Governorates
INSERT INTO public.locations (parent_id, level, name_ar, name_en, slug, is_new_urban_community, sort_order)
VALUES
  (NULL, 'governorate', 'القاهرة', 'Cairo', 'cairo', false, 1),
  (NULL, 'governorate', 'الجيزة', 'Giza', 'giza', false, 2),
  (NULL, 'governorate', 'الإسكندرية', 'Alexandria', 'alexandria', false, 3),
  (NULL, 'governorate', 'القليوبية', 'Qalyubia', 'qalyubia', false, 4),
  (NULL, 'governorate', 'الشرقية', 'Sharqia', 'sharqia', false, 5),
  (NULL, 'governorate', 'الدقهلية', 'Dakahlia', 'dakahlia', false, 6),
  (NULL, 'governorate', 'الغربية', 'Gharbia', 'gharbia', false, 7),
  (NULL, 'governorate', 'المنوفية', 'Monufia', 'monufia', false, 8),
  (NULL, 'governorate', 'البحيرة', 'Beheira', 'beheira', false, 9),
  (NULL, 'governorate', 'كفر الشيخ', 'Kafr El Sheikh', 'kafr-el-sheikh', false, 10),
  (NULL, 'governorate', 'دمياط', 'Damietta', 'damietta', false, 11),
  (NULL, 'governorate', 'بورسعيد', 'Port Said', 'port-said', false, 12),
  (NULL, 'governorate', 'الإسماعيلية', 'Ismailia', 'ismailia', false, 13),
  (NULL, 'governorate', 'السويس', 'Suez', 'suez', false, 14),
  (NULL, 'governorate', 'مطروح', 'Matrouh', 'matrouh', false, 15),
  (NULL, 'governorate', 'شمال سيناء', 'North Sinai', 'north-sinai', false, 16),
  (NULL, 'governorate', 'جنوب سيناء', 'South Sinai', 'south-sinai', false, 17),
  (NULL, 'governorate', 'البحر الأحمر', 'Red Sea', 'red-sea', false, 18),
  (NULL, 'governorate', 'الفيوم', 'Fayoum', 'fayoum', false, 19),
  (NULL, 'governorate', 'بني سويف', 'Beni Suef', 'beni-suef', false, 20),
  (NULL, 'governorate', 'المنيا', 'Minya', 'minya', false, 21),
  (NULL, 'governorate', 'أسيوط', 'Asyut', 'asyut', false, 22),
  (NULL, 'governorate', 'سوهاج', 'Sohag', 'sohag', false, 23),
  (NULL, 'governorate', 'قنا', 'Qena', 'qena', false, 24),
  (NULL, 'governorate', 'الأقصر', 'Luxor', 'luxor', false, 25),
  (NULL, 'governorate', 'أسوان', 'Aswan', 'aswan', false, 26),
  (NULL, 'governorate', 'الوادي الجديد', 'New Valley', 'new-valley', false, 27)
ON CONFLICT (slug) DO NOTHING;

-- 2. Seed Major Cities & New Urban Communities linked to their Governorates
WITH gov AS (
  SELECT id, slug FROM public.locations WHERE level = 'governorate'
)
INSERT INTO public.locations (parent_id, level, name_ar, name_en, slug, is_new_urban_community, sort_order)
SELECT gov_id, 'city'::public.location_level_enum, name_ar, name_en, city_slug, is_new_city, sort_order
FROM (
  VALUES
    -- Cairo
    ((SELECT id FROM gov WHERE slug = 'cairo'), 'القاهرة الجديدة', 'New Cairo', 'new-cairo', true, 1),
    ((SELECT id FROM gov WHERE slug = 'cairo'), 'العاصمة الإدارية الجديدة', 'New Administrative Capital', 'new-administrative-capital', true, 2),
    ((SELECT id FROM gov WHERE slug = 'cairo'), 'مدينة نصر', 'Nasr City', 'nasr-city', false, 3),
    ((SELECT id FROM gov WHERE slug = 'cairo'), 'المعادي', 'Maadi', 'maadi', false, 4),
    ((SELECT id FROM gov WHERE slug = 'cairo'), 'مصر الجديدة', 'Heliopolis', 'heliopolis', false, 5),
    ((SELECT id FROM gov WHERE slug = 'cairo'), 'الزمالك', 'Zamalek', 'zamalek', false, 6),
    ((SELECT id FROM gov WHERE slug = 'cairo'), 'الشروق', 'El Shorouk', 'el-shorouk', true, 7),
    ((SELECT id FROM gov WHERE slug = 'cairo'), 'بدر', 'Badr City', 'badr-city', true, 8),
    ((SELECT id FROM gov WHERE slug = 'cairo'), 'حدائق العاصمة', 'Capital Gardens', 'capital-gardens', true, 9),
    ((SELECT id FROM gov WHERE slug = 'cairo'), '15 مايو', '15th of May City', '15th-of-may', true, 10),
    -- Giza
    ((SELECT id FROM gov WHERE slug = 'giza'), 'الشيخ زايد', 'Sheikh Zayed', 'sheikh-zayed', true, 1),
    ((SELECT id FROM gov WHERE slug = 'giza'), 'السادس من أكتوبر', '6th of October', '6th-of-october', true, 2),
    ((SELECT id FROM gov WHERE slug = 'giza'), 'حدائق أكتوبر', 'October Gardens', 'october-gardens', true, 3),
    ((SELECT id FROM gov WHERE slug = 'giza'), 'أكتوبر الجديدة', 'New October', 'new-october', true, 4),
    ((SELECT id FROM gov WHERE slug = 'giza'), 'المهندسين', 'Mohandessin', 'mohandessin', false, 5),
    ((SELECT id FROM gov WHERE slug = 'giza'), 'الدقي', 'Dokki', 'dokki', false, 6),
    ((SELECT id FROM gov WHERE slug = 'giza'), 'حدائق الأهرام', 'Hadayek Al Ahram', 'hadayek-al-ahram', false, 7),
    -- Alexandria
    ((SELECT id FROM gov WHERE slug = 'alexandria'), 'سموحة', 'Smouha', 'smouha', false, 1),
    ((SELECT id FROM gov WHERE slug = 'alexandria'), 'سيدي جابر', 'Sidi Gaber', 'sidi-gaber', false, 2),
    ((SELECT id FROM gov WHERE slug = 'alexandria'), 'برج العرب الجديدة', 'New Borg El Arab', 'new-borg-el-arab', true, 3),
    ((SELECT id FROM gov WHERE slug = 'alexandria'), 'المنتزه', 'Montaza', 'montaza', false, 4),
    -- Qalyubia
    ((SELECT id FROM gov WHERE slug = 'qalyubia'), 'مدينة العبور', 'Obour City', 'obour-city', true, 1),
    ((SELECT id FROM gov WHERE slug = 'qalyubia'), 'العبور الجديدة', 'New Obour', 'new-obour', true, 2),
    ((SELECT id FROM gov WHERE slug = 'qalyubia'), 'بنها', 'Banha', 'banha', false, 3),
    -- Sharqia
    ((SELECT id FROM gov WHERE slug = 'sharqia'), 'العاشر من رمضان', '10th of Ramadan', '10th-of-ramadan', true, 1),
    ((SELECT id FROM gov WHERE slug = 'sharqia'), 'الصالحية الجديدة', 'New Salheya', 'new-salheya', true, 2),
    ((SELECT id FROM gov WHERE slug = 'sharqia'), 'الزقازيق', 'Zagazig', 'zagazig', false, 3),
    -- Dakahlia
    ((SELECT id FROM gov WHERE slug = 'dakahlia'), 'المنصورة', 'Mansoura', 'mansoura', false, 1),
    ((SELECT id FROM gov WHERE slug = 'dakahlia'), 'المنصورة الجديدة', 'New Mansoura', 'new-mansoura', true, 2),
    -- Monufia
    ((SELECT id FROM gov WHERE slug = 'monufia'), 'مدينة السادات', 'Sadat City', 'sadat-city', true, 1),
    ((SELECT id FROM gov WHERE slug = 'monufia'), 'شبين الكوم', 'Shibin El Kom', 'shibin-el-kom', false, 2),
    -- Damietta
    ((SELECT id FROM gov WHERE slug = 'damietta'), 'دمياط الجديدة', 'New Damietta', 'new-damietta', true, 1),
    -- Matrouh
    ((SELECT id FROM gov WHERE slug = 'matrouh'), 'العلمين الجديدة', 'New Alamein', 'new-alamein', true, 1),
    ((SELECT id FROM gov WHERE slug = 'matrouh'), 'مرسى مطروح', 'Marsa Matrouh', 'marsa-matrouh', false, 2),
    -- Beheira
    ((SELECT id FROM gov WHERE slug = 'beheira'), 'النوبارية الجديدة', 'New Nubariya', 'new-nubariya', true, 1),
    ((SELECT id FROM gov WHERE slug = 'beheira'), 'دمنهور', 'Damanhour', 'damanhour', false, 2),
    -- Gharbia
    ((SELECT id FROM gov WHERE slug = 'gharbia'), 'طنطا', 'Tanta', 'tanta', false, 1),
    -- Kafr El Sheikh
    ((SELECT id FROM gov WHERE slug = 'kafr-el-sheikh'), 'كفر الشيخ', 'Kafr El Sheikh City', 'kafr-el-sheikh-city', false, 1),
    -- Canal & Sinai & Red Sea
    ((SELECT id FROM gov WHERE slug = 'port-said'), 'شرق بورسعيد الجديدة', 'New East Port Said', 'new-east-port-said', true, 1),
    ((SELECT id FROM gov WHERE slug = 'ismailia'), 'الإسماعيلية الجديدة', 'New Ismailia', 'new-ismailia', true, 1),
    ((SELECT id FROM gov WHERE slug = 'suez'), 'السويس الجديدة', 'New Suez', 'new-suez', true, 1),
    ((SELECT id FROM gov WHERE slug = 'south-sinai'), 'شرم الشيخ', 'Sharm El Sheikh', 'sharm-el-sheikh', false, 1),
    ((SELECT id FROM gov WHERE slug = 'north-sinai'), 'العريش', 'Arish', 'arish', false, 1),
    ((SELECT id FROM gov WHERE slug = 'red-sea'), 'الغردقة', 'Hurghada', 'hurghada', false, 1),
    -- Upper Egypt
    ((SELECT id FROM gov WHERE slug = 'fayoum'), 'الفيوم الجديدة', 'New Fayoum', 'new-fayoum', true, 1),
    ((SELECT id FROM gov WHERE slug = 'bani-suef'), 'بني سويف الجديدة', 'New Beni Suef', 'new-beni-suef', true, 1),
    ((SELECT id FROM gov WHERE slug = 'minya'), 'المنيا الجديدة', 'New Minya', 'new-minya', true, 1),
    ((SELECT id FROM gov WHERE slug = 'asyut'), 'أسيوط الجديدة', 'New Asyut', 'new-asyut', true, 1),
    ((SELECT id FROM gov WHERE slug = 'sohag'), 'سوهاج الجديدة', 'New Sohag', 'new-sohag', true, 1),
    ((SELECT id FROM gov WHERE slug = 'qena'), 'قنا الجديدة', 'New Qena', 'new-qena', true, 1),
    ((SELECT id FROM gov WHERE slug = 'luxor'), 'طيبة الجديدة', 'New Thebes', 'new-thebes', true, 1),
    ((SELECT id FROM gov WHERE slug = 'aswan'), 'أسوان الجديدة', 'New Aswan', 'new-aswan', true, 1),
    ((SELECT id FROM gov WHERE slug = 'new-valley'), 'الخارجة', 'Kharga', 'kharga', false, 1)
) AS v(gov_id, name_ar, name_en, city_slug, is_new_city, sort_order)
WHERE v.gov_id IS NOT NULL
ON CONFLICT (slug) DO NOTHING;

-- 3. Default Site Settings (Configurable by Admin Dashboard)
INSERT INTO public.site_settings (key, value, description)
VALUES
  (
    'free_listing_days',
    '{"days": 7}'::jsonb,
    'Default duration in days for free property advertisements'
  ),
  (
    'listing_pricing',
    '{
      "currency": "EGP",
      "paid": {"7": 50, "15": 90, "30": 150},
      "featured": {"7": 100, "15": 175, "30": 250}
    }'::jsonb,
    'Configurable pricing tiers for paid and featured property listings'
  ),
  (
    'payment_channels',
    '{"instapay": true, "whatsapp": "01100602788"}'::jsonb,
    'Manual payment verification channels (InstaPay & WhatsApp)'
  )
ON CONFLICT (key) DO NOTHING;

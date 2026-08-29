// WASSILHA delivery-data.ts
// Local source-of-truth for the 41 neighbourhoods of El Guerrara and the
// ~65 verified delivery landmarks (mosques, schools, pharmacies, ...).
// Mirrors the DeliveryArea / DeliveryPoint Prisma tables. Kept as local
// typed constants so that the UI can ship with sensible defaults even
// before the database is seeded, and so that we never invent coordinates
// we have not verified.
//
// Both arrays are declared as const so consumers can derive literal
// types from them. No point carries latitude/longitude here on purpose.
// The picker falls back to GUERRARA_CENTER for any point without coords.

export const deliveryAreas: ReadonlyArray<readonly [string, string, string]> = [
  ['أولاد نايل', 'Ouled Nail', 'ouled-nail'],
  ['أولاد سيدي نايل', 'Ouled Sidi Naïl', 'ouled-sidi-nail'],
  ['سيدي عبد القادر', 'Sidi Abdelkader', 'sidi-abdelkader'],
  ['رويبح مختار', 'Rouibah Mokhtar', 'rouibah-mokhtar'],
  ['أولاد سايح', 'Ouled Sayeh', 'ouled-sayeh'],
  ['القصر القديم', 'Vieux Ksar', 'vieux-ksar'],
  ['عيسات إدير', 'Aissat Idir', 'aissat-idir'],
  ['العربي بن مهيدي', "Larbi Ben M'Hidi", 'larbi-ben-mhidi'],
  ['الحمام', 'El Hammam', 'el-hammam'],
  ['أولاد زيد', 'Ouled Zid', 'ouled-zid'],
  ['أولاد سي محمد', "Ouled Si M'Hamed", 'ouled-si-mhamed'],
  ['أولاد سي عيسى', 'Ouled Si Aissa', 'ouled-si-aissa'],
  ['بوقرطاس', 'Boukertas', 'boukertas'],
  ['الحاج مؤذن', 'Hadj Mouadhen', 'hadj-mouadhen'],
  ['القرية الفلاحية', 'Village Agricole', 'village-agricole'],
  ['كدية الشوف', 'Koudiet Chouf', 'koudiet-chouf'],
  ['الشيحية', 'Chihia / Ech-Chiha', 'chihia'],
  ['المنطقة الصناعية', 'Zone Industrielle', 'zone-industrielle'],
  ['المنطقة الحرفية', 'Zone Artisanale', 'zone-artisanale'],
  ['مفدي زكريا', 'Moufdi Zakaria', 'moufdi-zakaria'],
  ['عميروش', 'Amirouche', 'amirouche'],
  ['العقيد لطفي', 'Colonel Lotfi', 'colonel-lotfi'],
  ['حي مدرسة الحياة', 'Cité École El Hayat', 'ecole-el-hayat'],
  ['حي الشيخ الدبوز', 'Cité Cheikh Debbouz', 'cheikh-debbouz'],
  ['Belle Vue', 'Belle Vue', 'belle-vue'],
  ['Argoub El Dguel', 'Argoub El Dguel', 'argoub-el-dguel'],
  ['سيدي بلخير', 'Sidi Belkheir', 'sidi-belkheir'],
  ['114 مسكن', '114 Logements', '114-logements'],
  ['حي المجاهدين', 'Cité des Moudjahidine', 'moudjahidine'],
  ['امتداد عميروش', 'Extension Amirouche', 'extension-amirouche'],
  ['محمود', 'Mahmoud', 'mahmoud'],
  ['السماّر', 'El Semar', 'el-semar'],
  ['تقوى', 'Taquoua', 'taquoua'],
  ['شارع المدارس', 'Rue des Écoles', 'rue-des-ecoles'],
  ['ساقية الدجناية', 'Sakiet El-Djania', 'sakiet-el-djania'],
  ['السحن', 'El-Sahn', 'el-sahn'],
  ["Agherm N'Tizefriouine", "Agherm N'Tizefriouine", 'aghem-n-tizefriouine'],
  ['11 décembre', '11 Décembre', '11-decembre'],
  ['العقيد عميروش', 'Colonel Amirouche', 'colonel-amirouche'],
  ['سي الحواس', 'Si El Haouas', 'si-el-haouas'],
  ['حمو لقمان', 'Hamou Lakmane', 'hamou-lakmane'],
];

export type DeliveryAreaSlug = (typeof deliveryAreas)[number][2];

// Each tuple: [areaSlug, nameAr, nameFr, type]
// type must match a value of the DeliveryPointType enum on the server.
export const deliveryPoints: ReadonlyArray<
  readonly [DeliveryAreaSlug, string, string, string]
> = [
  // أولاد نايل
  ['ouled-nail', 'مكتب بريد أولاد نايل', 'Bureau de poste Oulad Nail', 'POST'],
  ['ouled-nail', 'CEM أولاد نايل الجديدة', 'CEM Ouled Nail El Djadida', 'SCHOOL'],
  ['ouled-nail', 'مدرسة المختار', 'École primaire Al-Mokhtar', 'SCHOOL'],
  ['ouled-nail', 'مسجد عمر بن عبد العزيز', 'Mosquée Omar ibn Abd al-Aziz', 'MOSQUE'],
  ['ouled-nail', 'مسجد حمزة بن عبد المطلب', 'Mosquée Hamza ibn Abd al-Mouttalib', 'MOSQUE'],
  ['ouled-nail', 'صيدلية حمايمي', 'Pharmacie Hamaimi Kecita Oum Saad', 'PHARMACY'],

  // أولاد سيدي نايل
  ['ouled-sidi-nail', 'CEM أولاد سيدي نايل', 'CEM Ouled Sidi Naïl', 'SCHOOL'],
  ['ouled-sidi-nail', 'صيدلية كسيطة', 'Pharmacie Kseita', 'PHARMACY'],
  ['ouled-sidi-nail', 'مسجد معاذ بن جبل', 'Mosquée Mouadh ibn Djabal', 'MOSQUE'],
  ['ouled-sidi-nail', 'دار الشباب', 'Maison des jeunes', 'YOUTH_CENTER'],
  ['ouled-sidi-nail', 'السوق', 'Marché', 'MARKET'],

  // سيدي عبد القادر
  ['sidi-abdelkader', 'مقبرة سيدي عبد القادر', 'Cimetière Sidi Abdelkader', 'CEMETERY'],
  ['sidi-abdelkader', 'متقن القرارة', 'Institut / Technicum Guerrara', 'SCHOOL'],

  // رويبح مختار
  ['rouibah-mokhtar', 'عيادة الشهيد رويبح مختار', 'Polyclinique Chahid Mokhtar Rouibeh', 'HEALTH'],
  ['rouibah-mokhtar', 'ابتدائية الشهيد رويبح المختار', 'École primaire Chahid Rouibeh Mokhtar', 'SCHOOL'],

  // القصر القديم
  ['vieux-ksar', 'الجامع الكبير', 'Grande Mosquée', 'MOSQUE'],
  ['vieux-ksar', 'سوق القرارة القديم', 'Ancien marché de Guerrara', 'MARKET'],

  // عيسات إدير
  ['aissat-idir', 'ابتدائية الشيخ البشير الإبراهيمي', 'École primaire Cheikh El Bachir El Ibrahimi', 'SCHOOL'],
  ['aissat-idir', 'CNAS', 'CNAS Guerrara', 'ADMINISTRATION'],
  ['aissat-idir', 'الحماية المدنية', 'Protection Civile', 'CIVIL_PROTECTION'],

  // العربي بن مهيدي
  ['larbi-ben-mhidi', 'متوسطة الشيخ محمد علي الدبوز', "CEM Cheikh Mohammed Ali Ed-Dabbouz", 'SCHOOL'],
  ['larbi-ben-mhidi', 'معهد الحياة', 'Institut El-Hayat', 'SCHOOL'],
  ['larbi-ben-mhidi', 'مكتب بريد 5 جويلية', 'Bureau de poste 5 Juillet', 'POST'],

  // أولاد زيد
  ['ouled-zid', 'تجزئة أولاد زيد', 'Lotissement Ouled Zaid', 'AREA'],

  // أولاد سي عيسى
  ['ouled-si-aissa', 'ساقية العين – أولاد سي عيسى', 'Hai Saguiat El Ain – Ouled Si Aissa', 'AREA'],

  // بوقرطاس
  ['boukertas', 'عيادة الشهيد إبراهيم بوقرطاس', 'Polyclinique Chahid Ibrahim Boukertas', 'HEALTH'],
  ['boukertas', 'حي إبراهيم بوقرطاس', 'Cité Ibrahim Boukertas', 'AREA'],

  // الحاج مؤذن
  ['hadj-mouadhen', 'مقبرة الشيخ الحاج محمد المؤذن', 'Cimetière Cheikh Hadj Mohamed Mouadhen', 'CEMETERY'],

  // القرية الفلاحية
  ['village-agricole', 'القرية الفلاحية', 'Village Agricole', 'AREA'],

  // كدية الشوف
  ['koudiet-chouf', 'كدية الشوف', 'Koudiet Chouf', 'AREA'],

  // الشيحية
  ['chihia', 'الشيحية', 'Chihia / Ech-Chiha', 'AREA'],
  ['chihia', 'ملبنة الأصيل', 'Laiterie El Assil', 'FACTORY'],
  ['chihia', 'منطقة نشاطات الشيحية', "Zone d'Activités Chihia", 'ARTISANAL'],

  // المنطقة الصناعية
  ['zone-industrielle', 'المنطقة الصناعية', 'GUERRARA ZONE INDUSTRIELLE', 'FACTORY'],
  ['zone-industrielle', 'GueraPlast', 'Sarl GueraPlast', 'FACTORY'],
  ['zone-industrielle', 'TISCOBA', 'TISCOBA / Tissage Mécanique', 'FACTORY'],

  // المنطقة الحرفية
  ['zone-artisanale', 'المنطقة الحرفية A2/20', 'Zone artisanale A2/20', 'ARTISANAL'],
  ['zone-artisanale', 'Grand Sud Plastique', 'Grand Sud Plastique – GSP', 'FACTORY'],

  // مفدي زكريا
  ['moufdi-zakaria', 'حي مفدي زكريا', 'Quartier Moufdi Zakaria', 'AREA'],

  // عميروش
  ['amirouche', 'ابتدائية العقيد عميروش', 'École primaire Colonel Amirouche', 'SCHOOL'],
  ['amirouche', 'ثانوية الإمام الشيخ بيوض إبراهيم', 'Lycée Imam Cheikh Bayoud Ibrahim', 'SCHOOL'],
  ['amirouche', 'الحماية المدنية', 'Protection Civile', 'CIVIL_PROTECTION'],
  ['amirouche', 'الدرك الوطني', 'Gendarmerie Nationale', 'POLICE'],

  // العقيد لطفي
  ['colonel-lotfi', 'حي العقيد لطفي', 'Quartier Colonel Lotfi', 'AREA'],

  // مدرسة الحياة
  ['ecole-el-hayat', 'مدرسة الحياة', 'École El-Hayat', 'SCHOOL'],
  ['ecole-el-hayat', 'صيدلية ابن سينا', 'Pharmacie Ibn Sina', 'PHARMACY'],

  // الشيخ الدبوز
  ['cheikh-debbouz', 'متوسطة الدبوز', 'CEM Debbouz', 'SCHOOL'],

  // سيدي بلخير
  ['sidi-belkheir', 'CEM سيدي بلخير', 'CEM Sidi Belkheir', 'SCHOOL'],
  ['sidi-belkheir', 'دار الشباب', 'Maison de jeunes', 'YOUTH_CENTER'],
  ['sidi-belkheir', 'الحماية المدنية', 'Protection Civile', 'CIVIL_PROTECTION'],
  ['sidi-belkheir', 'الدرك الوطني', 'Gendarmerie Nationale', 'POLICE'],
  ['sidi-belkheir', 'CNAS', 'CNAS Guerrara', 'ADMINISTRATION'],

  // محمود
  ['mahmoud', 'حي محمود', 'Cité Mahmoud', 'AREA'],
  ['mahmoud', 'وكالة اتصالات الجزائر', 'Algérie Télécom – Agence Guerrara', 'ADMINISTRATION'],
  ['mahmoud', 'Cabinet El Mahabba', 'Cabinet El Mahabba', 'HEALTH'],
  ['mahmoud', 'مسجد الحمد', 'Mosquée El Hamd', 'MOSQUE'],

  // شارع المدارس
  ['rue-des-ecoles', 'شارع المدارس', 'Rue des Écoles', 'AREA'],
  ['rue-des-ecoles', 'متوسطة ابن خلدون', 'CEM Ibn Khaldoun', 'SCHOOL'],

  // السحن
  ['el-sahn', 'ثانوية السحن', 'Lycée El Sahn', 'SCHOOL'],

  // Agherm
  ['aghem-n-tizefriouine', "Agherm N'Tizefriouine", "Agherm N'Tizefriouine", 'AREA'],

  // 11 ديسمبر
  ['11-decembre', '11 ديسمبر', '11 Décembre', 'AREA'],
  ['11-decembre', 'دار الشباب', 'Maison de jeunes', 'YOUTH_CENTER'],
  ['11-decembre', 'مركز إعلام وترقية الشباب', "Centre d'information et promotion jeunes", 'YOUTH_CENTER'],

  // سي الحواس
  ['si-el-haouas', 'حي سي الحواس', 'Cité Si El Haouas', 'AREA'],

  // حمو لقمان
  ['hamou-lakmane', 'حي حمو لقمان', 'Cité Hamou Lakmane', 'AREA'],
];
// 设备配置 - SKU与设备信息映射
// 方便后续添加新设备，只需在此文件中添加配置即可

export const deviceConfig = [
  // ==================== 词典笔系列 ====================
  {
    name: '词典笔A6',
    category: 'pen',
    image: 'https://ydschool-video.nosdn.127.net/17725259511549.png',
    skuPatterns: ['OVERHEAD_A61', 'A61'],
    specs: {
      sku: 'OVERHEAD_A61_SKU_CHN_STD',
      codeName: 'A6',
      cpu: 'RV1106',
      storage: '32GB',
      ram: '128MB',
      display: '1.9英寸',
      battery: '900mAh',
      wifi: '博流 BL602',
      manufacturer: '凯木金',
    }
  },
  {
    name: '词典笔A6P',
    category: 'pen',
    image: 'https://ydschool-video.nosdn.127.net/17725259511549.png',
    skuPatterns: ['OVERHEAD_A62', 'A62', 'PEAR'],
    specs: {
      sku: 'OVERHEAD_A62_SKU_CHN_PRO',
      codeName: 'pear',
      cpu: 'RV1106',
      storage: '32GB',
      ram: '128MB',
      display: '3.02英寸',
      battery: '900mAh',
      wifi: '博流 BL602',
      manufacturer: '麦度',
    }
  },
  {
    name: '词典笔A7',
    category: 'pen',
    image: 'https://ydschool-video.nosdn.127.net/17725259511549.png',
    skuPatterns: ['OVERHEAD_Y09_SKU', 'Y09_SKU'],
    specs: {
      sku: 'OVERHEAD_Y09_SKU_CHN_PLUS',
      codeName: 'Y09',
      cpu: 'RV1106',
      storage: '32GB',
      ram: '128MB',
      display: '3.48英寸',
      battery: '820mAh',
      wifi: '希微 SWT6521',
      manufacturer: '麦度',
    }
  },
  {
    name: '词典笔A7P',
    category: 'pen',
    image: 'https://ydschool-video.nosdn.127.net/17725259511549.png',
    skuPatterns: ['OVERHEAD_Y09P', 'Y09P'],
    specs: {
      sku: 'OVERHEAD_Y09P_SKU_CHN_PRO',
      codeName: 'Y09',
      cpu: 'RV1106',
      storage: '32GB',
      ram: '128MB',
      display: '3.93英寸',
      battery: '820mAh',
      wifi: '希微 SWT6521',
      manufacturer: '麦度',
    }
  },
  {
    name: '词典笔G3',
    category: 'pen',
    image: 'https://ydschool-video.nosdn.127.net/17725261877461605937782513banner.png',
    skuPatterns: ['OVERHEAD_G3', 'G3_SKU', 'KIWI'],
    specs: {
      sku: 'OVERHEAD_G3_SKU_CHN_STD',
      codeName: 'kiwi',
      cpu: 'RK3326',
      storage: '16GB',
      ram: '1GB',
      display: '2.39英寸',
      battery: '910mAh',
      wifi: '2.4G',
    }
  },
  {
    name: '词典笔K3',
    category: 'pen',
    image: 'https://ydschool-video.nosdn.127.net/17725261877461605937782513banner.png',
    skuPatterns: ['OVERHEAD_K3', 'K3_SKU', 'MANGO'],
    specs: {
      sku: 'OVERHEAD_K3_SKU_CHN_STD',
      codeName: 'mango',
      cpu: 'RK3326',
      storage: '16GB',
      ram: '1GB',
      display: '1.9英寸',
      battery: '900mAh',
    }
  },
  {
    name: '词典笔P5',
    category: 'pen',
    image: 'https://ydschool-video.nosdn.127.net/17725263896473e338d5c8d97401ff9fca8eb57771ddc.png',
    skuPatterns: ['OVERHEAD_P51', 'P51', 'ALMOND'],
    specs: {
      sku: 'OVERHEAD_P51_SKU_CHN_PRO',
      codeName: 'almond',
      cpu: 'RK3566',
      storage: '32GB',
      ram: '1GB',
      display: '3.68英寸',
      battery: '1350mAh',
    }
  },
  {
    name: '词典笔S6',
    category: 'pen',
    image: 'https://ydschool-video.nosdn.127.net/17725259509592.png',
    skuPatterns: ['OVERHEAD_S6_SKU', 'PLUM'],
    specs: {
      sku: 'OVERHEAD_S6_SKU_CHN_PRO',
      codeName: 'plum',
      cpu: 'CV1826',
      storage: '32GB',
      ram: '512MB',
      display: '2.39英寸',
      battery: '1020mAh',
    }
  },
  {
    name: '词典笔S6P',
    category: 'pen',
    image: 'https://ydschool-video.nosdn.127.net/17725259509592.png',
    skuPatterns: ['OVERHEAD_S62', 'S62', 'PINEAPPLE'],
    specs: {
      sku: 'OVERHEAD_S62_SKU_CHN_PRO',
      codeName: 'pineapple',
      cpu: 'CV1826',
      storage: '32GB',
      ram: '512MB',
      display: '3.02英寸',
      battery: '1020mAh',
    }
  },
  {
    name: '词典笔S7',
    category: 'pen',
    image: 'https://ydschool-video.nosdn.127.net/17725259509561.png',
    skuPatterns: ['OVERHEAD_Y08', 'Y08'],
    specs: {
      sku: 'OVERHEAD_Y08_SKU_CHN_PLUS',
      codeName: 'Y08',
      cpu: 'CV1813H-A',
      storage: '32GB',
      ram: '512MB',
      display: '4.24英寸',
      battery: '1020mAh',
      wifi: '希微 SWT6521',
    }
  },
  {
    name: '词典笔X3S',
    category: 'pen',
    image: 'https://ydschool-video.nosdn.127.net/17725261877461605937782513banner.png',
    skuPatterns: ['OVERHEAD_X3S', 'X3S'],
    specs: {
      sku: 'OVERHEAD_X3S_SKU_CHN_STD',
      codeName: 'X3S',
      cpu: 'RK3566',
      storage: '16GB',
      ram: '1GB',
      display: '2.97英寸',
      battery: '1100mAh',
    }
  },
  {
    name: '词典笔X5',
    category: 'pen',
    image: 'https://ydschool-video.nosdn.127.net/17725259506944.png',
    skuPatterns: ['OVERHEAD_X51_SKU_CHN_ADV', 'COCO'],
    specs: {
      sku: 'OVERHEAD_X51_SKU_CHN_ADV',
      codeName: 'coco',
      cpu: 'CV1826',
      storage: '8GB',
      ram: '512MB',
      display: '3.60英寸',
      battery: '1020mAh',
    }
  },
  {
    name: '词典笔X5 Pro',
    category: 'pen',
    image: 'https://ydschool-video.nosdn.127.net/17725259506944.png',
    skuPatterns: ['OVERHEAD_X51_SKU_CHN_PLUS', 'COCO_PRO'],
    specs: {
      sku: 'OVERHEAD_X51_SKU_CHN_PLUS',
      codeName: 'coco pro',
      cpu: 'RK3566',
      storage: '16GB',
      ram: '1GB',
      display: '3.6英寸',
      battery: '1020mAh',
    }
  },
  {
    name: '词典笔X6',
    category: 'pen',
    image: 'https://ydschool-video.nosdn.127.net/17725259506607.png',
    skuPatterns: ['OVERHEAD_X61', 'X61', 'MELON'],
    specs: {
      sku: 'OVERHEAD_X61_SKU_CHN_PRO',
      codeName: 'melon',
      cpu: 'CV1826',
      storage: '32GB',
      ram: '512MB',
      display: '3.68英寸',
      battery: '1250mAh',
      wifi: '恒玄 BES2600',
    }
  },
  {
    name: '词典笔X6P',
    category: 'pen',
    image: 'https://ydschool-video.nosdn.127.net/17725259506607.png',
    skuPatterns: ['OVERHEAD_X62', 'X62', 'MELON_PRO'],
    specs: {
      sku: 'OVERHEAD_X62_SKU_CHN_PLUS',
      codeName: 'melon pro',
      cpu: 'RK3562',
      storage: '32GB',
      ram: '1GB',
      display: '4.0英寸',
      battery: '1400mAh',
    }
  },
  {
    name: '词典笔X7',
    category: 'pen',
    image: 'https://ydschool-video.nosdn.127.net/177252595062311.png',
    skuPatterns: ['OVERHEAD_Y01', 'Y01'],
    specs: {
      sku: 'OVERHEAD_Y01_SKU_CHN_PRO',
      codeName: 'Y01',
      cpu: 'RK3562',
      storage: '32GB',
      ram: '1GB',
      display: '3.68英寸',
      battery: '1289mAh',
      wifi: '恒玄 BES2600',
    }
  },
  {
    name: '词典笔X7P',
    category: 'pen',
    image: 'https://ydschool-video.nosdn.127.net/17725259505958.png',
    skuPatterns: ['OVERHEAD_Y02_SKU', 'Y02_SKU'],
    specs: {
      sku: 'OVERHEAD_Y02_SKU_CHN_PLUS',
      codeName: 'Y02',
      cpu: 'RK3562',
      storage: '64GB',
      ram: '1GB',
      display: '4.1英寸',
      battery: '1406mAh',
      wifi: '恒玄 BES2600',
    }
  },
  {
    name: '答疑笔 space one',
    category: 'pen',
    image: 'https://ydschool-video.nosdn.127.net/177252595199112.png',
    skuPatterns: ['OVERHEAD_Y03', 'Y03WO', 'SPACE_ONE'],
    specs: {
      sku: 'OVERHEAD_Y03WO_SKU_CHN_PLUS',
      codeName: 'Y03',
      cpu: 'RK3562',
      storage: '64GB',
      ram: '1GB',
      display: '4.39英寸 OLED',
      battery: '1700mAh',
      wifi: '恒玄 BES2600',
    }
  },
  {
    name: '答疑笔 space X',
    category: 'pen',
    image: 'https://ydschool-video.nosdn.127.net/177252595176015.png',
    skuPatterns: ['OVERHEAD_Y07', 'Y07', 'SPACE_X'],
    specs: {
      sku: 'OVERHEAD_Y07_SKU_CHN_PLUS',
      codeName: 'Y07',
      cpu: 'RK3562',
      storage: '64GB',
      ram: '1GB',
      display: '4.39英寸',
      battery: '2500mAh',
      wifi: '希微 SWT6621',
    }
  },
  {
    name: '词典笔二代',
    category: 'pen',
    image: 'https://ydschool-video.nosdn.127.net/17725261066246c2a7ef527f9f5116dba08fb4e3116c7.png',
    skuPatterns: ['OVERHEAD_D2', 'D2_SKU'],
    specs: {
      sku: 'OVERHEAD_D2_SKU_CLA_ADV',
      codeName: '二代',
      cpu: 'RK3326',
      storage: '8GB',
      ram: '512MB',
      display: '1.9英寸',
      battery: '1000mAh',
    }
  },
  {
    name: '词典笔三代',
    category: 'pen',
    image: 'https://ydschool-video.nosdn.127.net/17725261877461605937782513banner.png',
    skuPatterns: ['OVERHEAD_D3', 'D3_SKU', 'CHERRY'],
    specs: {
      sku: 'OVERHEAD_D3_SKU_CHN_STD',
      codeName: 'cherry',
      cpu: 'RK3326',
      storage: '16GB',
      ram: '512MB',
      display: '2.97英寸',
      battery: '1100mAh',
    }
  },
  // ==================== 听力宝系列 ====================
  {
    name: '听力宝E6',
    category: 'audio',
    image: 'https://ydschool-video.nosdn.127.net/17725259515705.png',
    skuPatterns: ['REPEATER_RAE6_SKU', 'RAE6', 'HERMES'],
    specs: {
      sku: 'REPEATER_RAE6_SKU_CHN_PRO',
      codeName: 'hermes',
      cpu: 'RV1106',
      storage: '16GB',
      ram: '128MB',
      display: '2.4英寸',
      battery: '900mAh',
    }
  },
  {
    name: '听力宝E6P',
    category: 'audio',
    image: 'https://ydschool-video.nosdn.127.net/17725259515705.png',
    skuPatterns: ['REPEATER_RAE6P', 'RAE6P', 'HERMES_PRO'],
    specs: {
      sku: 'REPEATER_RAE6P_SKU_CHN_PLUS',
      codeName: 'hermes Pro',
      cpu: 'RV1106',
      storage: '32GB',
      ram: '128MB',
      display: '2.8英寸',
      battery: '1000mAh',
    }
  },
  {
    name: '听力宝Y05',
    category: 'audio',
    image: 'https://ydschool-video.nosdn.127.net/177252595118013.png',
    skuPatterns: ['REPEATER_Y05', 'Y05'],
    specs: {
      sku: 'REPEATER_Y05_SKU_CHN_PRO',
      codeName: 'Y05',
      cpu: 'RK3326',
      storage: '16GB',
      ram: '512MB',
      display: '2.4英寸',
      battery: '1000mAh',
    }
  },
  {
    name: '听力宝apollo pro',
    category: 'audio',
    image: 'https://ydschool-video.nosdn.127.net/177252595171010.png',
    skuPatterns: ['REPEATER_RA1P', 'RA1P', 'APOLLO'],
    specs: {
      sku: 'REPEATER_RA1P_SKU_CHN_ADV',
      codeName: 'apollo pro',
      cpu: 'RK3326',
      storage: '32GB',
      ram: '1GB',
      display: '3.5英寸',
      battery: '1500mAh',
    }
  },
  {
    name: '词典笔Y15',
    category: 'pen',
    image: 'https://ydschool-video.nosdn.127.net/17725259511549.png',
    skuPatterns: ['OVERHEAD_Y15', 'Y15'],
    specs: {
      sku: 'OVERHEAD_Y15_SKU_CHN_STD',
      codeName: 'Y15',
      cpu: 'RV1106',
      storage: '128MB',
      ram: '256MB',
      display: '3.48英寸 172x640',
      battery: '820mAh',
      wifi: '博流 BL602',
      manufacturer: '麦度',
    }
  },
  {
    name: '词典笔Y15P',
    category: 'pen',
    image: 'https://ydschool-video.nosdn.127.net/17725259511549.png',
    skuPatterns: ['OVERHEAD_Y15P', 'Y15P'],
    specs: {
      sku: 'OVERHEAD_Y15P_SKU_CHN_PRO',
      codeName: 'Y15P',
      cpu: 'RV1106',
      storage: '128MB',
      ram: '256MB',
      display: '3.93英寸 240x1020',
      battery: '820mAh',
      wifi: '博流 BL602',
      manufacturer: '麦度',
    }
  },
];

// SKU lookup cache
const skuCache = new Map();

// Find device by SKU
export function getDeviceBySku(sku: string) {
  if (!sku) return null;
  if (skuCache.has(sku)) return skuCache.get(sku);
  
  const skuUpper = sku.toUpperCase();
  const device = deviceConfig.find(d =>
    d.skuPatterns.some(pattern => skuUpper.includes(pattern.toUpperCase())) ||
    d.specs.codeName.toUpperCase().includes(skuUpper) ||
    skuUpper.includes(d.specs.codeName.toUpperCase())
  );
  
  skuCache.set(sku, device || null);
  return device || null;
}

// Get device image
export function getDeviceImage(sku: string) {
  return getDeviceBySku(sku)?.image || null;
}

// Get device specs
export function getDeviceSpecs(sku: string) {
  return getDeviceBySku(sku)?.specs || null;
}

// Clear cache
export function clearSkuCache() {
  skuCache.clear();
}

export default deviceConfig;

// WCAG Contrast Ratio Calculator and Test Suite

function hexToRgb(hex) {
  const cleanHex = hex.replace(/^#/, '');
  const bigint = parseInt(cleanHex, 16);
  const r = (bigint >> 16) & 255;
  const g = (bigint >> 8) & 255;
  const b = bigint & 255;
  return { r, g, b };
}

function getRelativeLuminance({ r, g, b }) {
  const [rs, gs, bs] = [r, g, b].map(val => {
    const s = val / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}

function calculateContrastRatio(colorHex1, colorHex2) {
  const rgb1 = hexToRgb(colorHex1);
  const rgb2 = hexToRgb(colorHex2);
  
  const l1 = getRelativeLuminance(rgb1);
  const l2 = getRelativeLuminance(rgb2);
  
  const brighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  
  return (brighter + 0.05) / (darker + 0.05);
}

function runContrastTest(label, textHex, bgHex) {
  const ratio = calculateContrastRatio(textHex, bgHex);
  const passAA_Normal = ratio >= 4.5;
  const passAA_Large = ratio >= 3.0;
  const passAAA_Normal = ratio >= 7.0;
  
  console.log(`[Contrast Test] ${label}`);
  console.log(`  Text Color: ${textHex}`);
  console.log(`  Background Color: ${bgHex}`);
  console.log(`  Contrast Ratio: ${ratio.toFixed(2)}:1`);
  console.log(`  WCAG AA (Normal Text >= 4.5): ${passAA_Normal ? 'PASS ✅' : 'FAIL ❌'}`);
  console.log(`  WCAG AA (Large Text >= 3.0):  ${passAA_Large ? 'PASS ✅' : 'FAIL ❌'}`);
  console.log(`  WCAG AAA (Normal Text >= 7.0): ${passAAA_Normal ? 'PASS ✅' : 'FAIL ❌'}`);
  console.log('----------------------------------------------------');
  
  return {
    label,
    textHex,
    bgHex,
    ratio,
    passAA_Normal,
    passAA_Large,
    passAAA_Normal
  };
}

// Run contrast tests on our proposed Light Mode color variables
console.log('=== FANTABULOUS LIGHT THEME CONTRAST TESTS ===\n');

// 1. Core Text Colors on White Card
runContrastTest('Text Primary (Slate 900) on White Card', '#0f172a', '#ffffff');
runContrastTest('Text Secondary (Slate 600) on White Card', '#475569', '#ffffff');
runContrastTest('Text Muted (Slate 500) on White Card', '#64748b', '#ffffff');

// 2. Ticker stats and labels in Inactive team selector tabs
runContrastTest('Text Inactive (Slate 600) on Slate 100 Tab', '#475569', '#f1f5f9');
runContrastTest('Text Inactive (Slate 500) on Slate 50 Page', '#64748b', '#f8fafc');

// 3. Play state colors (Win, Loss, Gold)
runContrastTest('Win Text (Emerald 800) on White Card', '#065f46', '#ffffff');
runContrastTest('Loss Text (Rose 700) on White Card', '#be123c', '#ffffff');
runContrastTest('Magic Number Gold (Amber 700) on White Card', '#b45309', '#ffffff');

// 4. Modal specific components
runContrastTest('Vis Tab Select Label (Slate 900) on Slate 200', '#0f172a', '#e2e8f0');
runContrastTest('Statcast Value text (Slate 900) on Slate 50 Details Box', '#0f172a', '#f8fafc');
runContrastTest('Statcast Labels (Slate 600) on Slate 50 Details Box', '#475569', '#f8fafc');

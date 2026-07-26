// Sütun-öncelikli 3x3 matris yardımcıları (WebGL uniformMatrix3fv ile uyumlu).

export function identity() {
  return [1, 0, 0, 0, 1, 0, 0, 0, 1];
}

export function multiply(a, b) {
  const o = new Array(9);
  for (let c = 0; c < 3; c++) {
    for (let r = 0; r < 3; r++) {
      o[c * 3 + r] =
        a[0 * 3 + r] * b[c * 3 + 0] +
        a[1 * 3 + r] * b[c * 3 + 1] +
        a[2 * 3 + r] * b[c * 3 + 2];
    }
  }
  return o;
}

export function translate(tx, ty) {
  return [1, 0, 0, 0, 1, 0, tx, ty, 1];
}

export function scale(sx, sy) {
  return [sx, 0, 0, 0, sy, 0, 0, 0, 1];
}

export function rotate(rad) {
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  return [c, s, 0, -s, c, 0, 0, 0, 1];
}

export function chain(...mats) {
  return mats.reduce((acc, m) => multiply(acc, m), identity());
}

export function apply(m, x, y) {
  return [
    m[0] * x + m[3] * y + m[6],
    m[1] * x + m[4] * y + m[7],
  ];
}

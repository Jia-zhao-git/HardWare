# 界面美化快速参考

## 🎨 CSS 类速查表

### 玻璃态效果
```html
<div class="glass-effect">基础玻璃态</div>
<div class="glass-panel">高级玻璃面板</div>
```

### 按钮样式
```html
<button class="btn-primary">主要按钮</button>
<button class="btn-secondary">次要按钮</button>
```

### 卡片样式
```html
<div class="card">基础卡片</div>
<div class="card card-gradient">渐变卡片</div>
<div class="info-card">信息卡片</div>
```

### 徽章样式
```html
<span class="badge badge-blue">蓝色</span>
<span class="badge badge-green">绿色</span>
<span class="badge badge-purple">紫色</span>
<span class="badge badge-warning">黄色</span>
<span class="badge badge-red">红色</span>
```

### 动画类
```html
<div class="animate-pulse">脉冲动画</div>
<div class="animate-bounce">弹跳动画</div>
<div class="animate-glow">发光动画</div>
<div class="shimmer">闪烁效果</div>
```

---

## 🌈 CSS 变量速查

### 渐变色
```css
var(--gradient-primary)    /* 紫蓝渐变 */
var(--gradient-secondary)  /* 粉紫渐变 */
var(--gradient-success)    /* 青蓝渐变 */
var(--gradient-warning)    /* 粉黄渐变 */
var(--gradient-dark)       /* 深蓝渐变 */
```

### 阴影
```css
var(--shadow-sm)   /* 小阴影 */
var(--shadow-md)   /* 中阴影 */
var(--shadow-lg)   /* 大阴影 */
var(--shadow-xl)   /* 超大阴影 */
var(--shadow-glow) /* 发光阴影 */
```

### 玻璃态
```css
var(--glass-bg)      /* 玻璃背景 */
var(--glass-border)  /* 玻璃边框 */
var(--glass-shadow)  /* 玻璃阴影 */
```

---

## 💡 使用示例

### 1. 创建现代化卡片
```html
<div class="card card-gradient" style="padding: 20px;">
  <h3>标题</h3>
  <p>内容...</p>
  <button class="btn-primary">操作</button>
</div>
```

### 2. 状态指示器
```html
<div style="display: flex; gap: 8px;">
  <span class="badge badge-green animate-pulse">● 在线</span>
  <span class="badge badge-red">● 离线</span>
  <span class="badge badge-warning">● 警告</span>
</div>
```

### 3. 加载骨架屏
```html
<div class="card shimmer" style="height: 100px;"></div>
```

### 4. 发光按钮
```html
<button class="btn-primary animate-glow">
  重要操作
</button>
```

### 5. 玻璃态面板
```html
<div class="glass-panel" style="padding: 24px; border-radius: 12px;">
  <h2>设置面板</h2>
  <!-- 内容 -->
</div>
```

---

## 🎯 组合使用技巧

### 卡片 + 动画
```html
<div class="card animate-glow">
  发光的卡片
</div>
```

### 按钮 + 徽章
```html
<button class="btn-primary">
  通知 <span class="badge badge-red">3</span>
</button>
```

### 表格行高亮
```html
<table class="process-table">
  <tr>
    <td><span class="badge badge-green">运行中</span></td>
  </tr>
</table>
```

---

## ⚡ 性能提示

### ✅ 推荐做法
- 使用 `transform` 和 `opacity` 动画
- 适度使用 `backdrop-filter`
- 避免在大面积元素上使用模糊

### ❌ 避免做法
- 同时运行多个复杂动画
- 在低性能设备上使用过多玻璃态
- 嵌套过多的模糊效果

---

## 🔧 自定义建议

### 调整玻璃态透明度
```css
.glass-effect {
  background: rgba(28, 33, 40, 0.8); /* 更不透明 */
}
```

### 修改动画速度
```css
.animate-pulse {
  animation-duration: 1s; /* 更快 */
}
```

### 自定义阴影颜色
```css
.card:hover {
  box-shadow: 0 16px 48px rgba(88, 166, 255, 0.3);
}
```

---

## 📱 响应式考虑

### 移动端优化
```css
@media (max-width: 768px) {
  .card:hover {
    transform: none; /* 禁用悬停效果 */
  }
  
  .glass-effect {
    backdrop-filter: blur(5px); /* 减少模糊 */
  }
}
```

---

**更多详情**: 查看 [UI_BEAUTIFICATION.md](./UI_BEAUTIFICATION.md)

import React from 'react';
import { motion } from 'framer-motion';
import {
  ArrowRight,
  CheckCircle2,
  ChevronRight,
  Layout,
  Library,
  Maximize2,
  MessageSquare,
  MousePointer2,
  Palette,
  PenTool,
  RefreshCw,
  Sparkles,
  Layers,
  Zap
} from 'lucide-react';
import heroBrandPoster from '../assets/landing/hero-brand-poster.png';
import heroCampusPoster from '../assets/landing/hero-campus-poster.png';
import heroExhibitionPoster from '../assets/landing/hero-exhibition-poster.png';
import heroPromoPoster from '../assets/landing/hero-promo-poster.png';
import workflowVariantPoster from '../assets/landing/workflow-variant-poster.png';
import refinementPoster from '../assets/landing/refinement-poster.png';
import styleReferencePast from '../assets/landing/style-reference-past.png';
import styleReferenceContinuation from '../assets/landing/style-reference-continuation.png';
import usecaseBrand from '../assets/landing/usecase-brand.png';
import usecaseCampus from '../assets/landing/usecase-campus.png';
import usecaseExhibition from '../assets/landing/usecase-exhibition.png';

type LandingPageProps = {
  onStartCreating: () => void;
};

const cardClass =
  'bg-white border border-slate-200/70 shadow-sm rounded-3xl overflow-hidden transition-all duration-300 hover:shadow-xl hover:shadow-slate-200/60 hover:-translate-y-1';
const glassNavClass = 'sticky top-0 z-50 bg-white/80 backdrop-blur-md border-b border-slate-200/70';
const brandBgClass = 'bg-[#ea4c89]';
const brandTextClass = 'text-[#ea4c89]';
const brandSoftBgClass = 'bg-[#ea4c89]/10';
const brandHoverBgClass = 'hover:bg-[#f082ac]';

const heroPosters = [
  { src: heroBrandPoster, alt: '品牌新品发布海报', title: 'AI 创意方案 01', direction: '视觉方向：品牌发布' },
  { src: heroCampusPoster, alt: '校园招新活动海报', title: 'AI 创意方案 02', direction: '视觉方向：青春活力' },
  { src: heroExhibitionPoster, alt: '艺术展览海报', title: 'AI 创意方案 03', direction: '视觉方向：艺术展陈' },
  { src: heroPromoPoster, alt: '商业促销海报', title: 'AI 创意方案 04', direction: '视觉方向：商业转化' }
];

const useCaseImages = [
  { src: usecaseCampus, alt: '校园活动案例海报' },
  { src: usecaseBrand, alt: '品牌传播案例海报' },
  { src: usecaseExhibition, alt: '演出展览案例海报' }
];

const NavBar: React.FC<LandingPageProps> = ({ onStartCreating }) => (
  <nav className={glassNavClass}>
    <div className="mx-auto flex h-20 max-w-7xl items-center justify-between px-6">
      <div className="flex items-center gap-2">
        <span className="text-xl font-bold tracking-tight text-slate-900">Posterize</span>
      </div>

      <div className="hidden items-center gap-8 text-sm font-medium text-slate-600 md:flex">
        <a href="#features" className="transition-colors hover:text-slate-900">功能特色</a>
        <a href="#workflow" className="transition-colors hover:text-slate-900">工作流</a>
        <a href="#assets" className="transition-colors hover:text-slate-900">品牌资产</a>
        <a href="#cases" className="transition-colors hover:text-slate-900">应用场景</a>
      </div>

      <div className="flex items-center gap-4">
        <button type="button" onClick={onStartCreating} className="text-sm font-medium text-slate-600 transition-colors hover:text-slate-900">
          登录
        </button>
        <button
          type="button"
          onClick={onStartCreating}
          className="rounded-full bg-slate-900 px-6 py-2.5 text-sm font-medium text-white shadow-lg shadow-slate-200 transition-all hover:bg-slate-800"
        >
          免费开始
        </button>
      </div>
    </div>
  </nav>
);

const Hero: React.FC<LandingPageProps> = ({ onStartCreating }) => (
  <section className="relative overflow-hidden pt-20 pb-32">
    <div className="relative z-10 mx-auto max-w-7xl px-6">
      <div className="mx-auto mb-16 max-w-3xl text-center">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className={`mb-6 inline-flex items-center gap-2 rounded-full px-4 py-2 text-xs font-bold uppercase tracking-wider ${brandSoftBgClass} ${brandTextClass}`}
        >
          <Zap size={14} />
          AI 驱动的海报生产系统
        </motion.div>
        <motion.h1
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.1 }}
          className="mb-8 text-5xl font-bold leading-[1.1] tracking-tight text-slate-900 md:text-7xl"
        >
          从一句需求到
          <br />
          <span className={brandTextClass}>专业级</span>成品海报
        </motion.h1>
        <motion.p
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.2 }}
          className="mb-10 text-lg leading-relaxed text-slate-500"
        >
          这不是一个单纯的 AI 出图工具。Posterize 是一个完整的海报生产系统，集成了 AI 创意策划、品牌资产管理与画板式协作流，让专业设计触手可及。
        </motion.p>
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.3 }}
          className="flex flex-col items-center justify-center gap-4 sm:flex-row"
        >
          <button
            type="button"
            onClick={onStartCreating}
            className={`group flex w-full items-center justify-center gap-2 rounded-full px-8 py-4 text-lg font-semibold text-white shadow-xl sm:w-auto ${brandBgClass} ${brandHoverBgClass}`}
          >
            立即创建项目
            <ArrowRight size={20} className="transition-transform group-hover:translate-x-1" />
          </button>
        </motion.div>
      </div>

      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.8, delay: 0.4 }}
        className="relative"
      >
        <div className="grid grid-cols-2 gap-6 md:grid-cols-4">
          {heroPosters.map((poster) => (
            <div key={poster.alt} className={`${cardClass} group relative aspect-[3/4]`}>
              <img src={poster.src} alt={poster.alt} className="h-full w-full bg-white object-contain" referrerPolicy="no-referrer" />
              <div className="absolute inset-0 flex flex-col justify-end bg-gradient-to-t from-black/60 via-transparent to-transparent p-6 opacity-0 transition-opacity group-hover:opacity-100">
                <p className="font-medium text-white">{poster.title}</p>
                <p className="text-sm text-white/70">{poster.direction}</p>
              </div>
            </div>
          ))}
        </div>

        <div className="absolute -top-12 -left-12 -z-10 h-64 w-64 rounded-full bg-[#ea4c89]/5 blur-3xl" />
        <div className="absolute -right-12 -bottom-12 -z-10 h-64 w-64 rounded-full bg-blue-500/5 blur-3xl" />
      </motion.div>
    </div>
  </section>
);

const Features: React.FC = () => {
  const features = [
    {
      icon: <Sparkles className={brandTextClass} />,
      title: 'AI 先策划，再出图',
      description: '系统自动拆解需求，生成标题、色调、视觉方向等多个创意方案，而非随机生成。'
    },
    {
      icon: <Palette className="text-blue-500" />,
      title: '可控品牌生成',
      description: '支持上传 Logo、品牌字体、参考风格图，让 AI 产出完美符合品牌调性的作品。'
    },
    {
      icon: <Layout className="text-emerald-500" />,
      title: '画板式创作流',
      description: '接近设计软件的白板交互，支持多画板布局、平移缩放，可视化管理创作全过程。'
    },
    {
      icon: <RefreshCw className="text-orange-500" />,
      title: '生成后持续精修',
      description: '支持文字反馈调整、AI 创意建议、带标注的局部修改，像和设计师沟通一样简单。'
    },
    {
      icon: <Maximize2 className="text-purple-500" />,
      title: '多尺寸智能延展',
      description: '一键将主视觉延展至不同分辨率与尺寸，保持内容与构图一致，适配多端投放。'
    },
    {
      icon: <Library className="text-pink-500" />,
      title: '个人视觉资产库',
      description: '长期沉淀风格图、Logo、字体等创作资产，让 AI 越用越懂你的审美偏好。'
    }
  ];

  return (
    <section id="features" className="bg-white py-32">
      <div className="mx-auto max-w-7xl px-6">
        <div className="mb-20 text-center">
          <h2 className="mb-4 text-4xl font-bold tracking-tight text-slate-900">不只是出图，是完整的生产力</h2>
          <p className="mx-auto max-w-2xl text-slate-500">
            Posterize 重新定义了 AI 辅助设计的边界，从资产管理到多端延展，覆盖海报生产的全链路。
          </p>
        </div>

        <div className="grid gap-8 md:grid-cols-3">
          {features.map((feature, index) => (
            <motion.div
              key={index}
              whileHover={{ y: -5 }}
              className="rounded-3xl border border-slate-100 bg-slate-50/70 p-8 transition-all hover:bg-white hover:shadow-xl hover:shadow-slate-200/50"
            >
              <div className="mb-6 flex h-12 w-12 items-center justify-center rounded-2xl bg-white shadow-sm">
                {feature.icon}
              </div>
              <h3 className="mb-3 text-xl font-bold text-slate-900">{feature.title}</h3>
              <p className="text-sm leading-relaxed text-slate-500">{feature.description}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
};

const WorkflowSection: React.FC = () => (
  <section id="workflow" className="overflow-hidden py-32">
    <div className="mx-auto max-w-7xl px-6">
      <div className="flex flex-col items-center gap-16 lg:flex-row">
        <div className="flex-1">
          <h2 className="mb-8 text-4xl font-bold tracking-tight text-slate-900">像在白板上推进设计</h2>
          <div className="space-y-8">
            {[
              ['1', '输入需求与资产', '挂载你的 Logo、参考图和字体，AI 将以此为上下文进行创作。'],
              ['2', '批量生成创意方案', 'AI 首先策划多个视觉方向，并以多个 Artboard 形式并行产出。'],
              ['3', '可视化精修与迭代', '在画布上直接标注修改意见，AI 实时响应并生成新的 Variation。']
            ].map(([step, title, desc]) => (
              <div key={step} className="flex gap-6">
                <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-slate-900 font-bold text-white">
                  {step}
                </div>
                <div>
                  <h4 className="mb-2 text-lg font-bold text-slate-900">{title}</h4>
                  <p className="text-sm text-slate-500">{desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="relative flex-1">
          <div className={`${cardClass} bg-slate-100 p-4`}>
            <div className="relative aspect-video overflow-hidden rounded-xl bg-white shadow-inner">
              <div className="absolute top-4 left-4 flex gap-2">
                <div className="h-3 w-3 rounded-full bg-red-400" />
                <div className="h-3 w-3 rounded-full bg-yellow-400" />
                <div className="h-3 w-3 rounded-full bg-green-400" />
              </div>
              <div className="mt-12 p-6">
                <div className="grid grid-cols-3 gap-4">
                  <div className="flex aspect-[3/4] items-center justify-center rounded-lg border-2 border-dashed border-slate-200 bg-slate-50">
                    <Sparkles className="text-slate-300" />
                  </div>
                  <div className="relative flex aspect-[3/4] items-center justify-center rounded-lg border-2 border-[#ea4c89]/20 bg-slate-50">
                    <img src={workflowVariantPoster} alt="海报创意方案缩略图" className="h-full w-full rounded-lg bg-white object-contain opacity-50" referrerPolicy="no-referrer" />
                    <div className="absolute inset-0 flex items-center justify-center">
                      <div className="rounded-full bg-white px-3 py-1 text-[10px] font-bold shadow-sm">生成中...</div>
                    </div>
                  </div>
                  <div className="flex aspect-[3/4] items-center justify-center rounded-lg border-2 border-dashed border-slate-200 bg-slate-50">
                    <Sparkles className="text-slate-300" />
                  </div>
                </div>
              </div>
              <motion.div
                animate={{ y: [0, -10, 0] }}
                transition={{ duration: 4, repeat: Infinity }}
                className="absolute right-10 bottom-10 flex items-center gap-3 rounded-2xl border border-slate-100 bg-white p-4 shadow-2xl"
              >
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-100 text-emerald-600">
                  <MousePointer2 size={16} />
                </div>
                <div>
                  <p className="text-[10px] font-bold uppercase text-slate-400">当前操作</p>
                  <p className="text-xs font-bold text-slate-900">调整标题层级</p>
                </div>
              </motion.div>
            </div>
          </div>
          <div className="absolute top-1/2 left-1/2 -z-10 h-[120%] w-[120%] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#ea4c89]/5 blur-[100px]" />
        </div>
      </div>
    </div>
  </section>
);

const RefinementSection: React.FC = () => (
  <section className="overflow-hidden bg-slate-900 py-32 text-white">
    <div className="mx-auto max-w-7xl px-6">
      <div className="grid items-center gap-20 lg:grid-cols-2">
        <div className="order-2 lg:order-1">
          <div className="relative">
            <img src={refinementPoster} alt="海报精修示意图" className="mx-auto w-full max-w-md rounded-3xl shadow-2xl" referrerPolicy="no-referrer" />
            <div className={`absolute top-1/4 left-1/3 flex h-8 w-8 items-center justify-center rounded-full font-bold shadow-lg ${brandBgClass}`}>1</div>
            <div className={`absolute right-1/4 bottom-1/3 flex h-8 w-8 items-center justify-center rounded-full font-bold shadow-lg ${brandBgClass}`}>2</div>
            <div className="absolute top-1/2 -right-8 hidden max-w-xs -translate-y-1/2 rounded-2xl bg-white p-6 text-slate-900 shadow-2xl md:block">
              <div className="mb-3 flex items-center gap-2">
                <MessageSquare size={16} className={brandTextClass} />
                <span className="text-xs font-bold uppercase tracking-wider text-slate-400">精修指令</span>
              </div>
              <p className="text-sm font-medium leading-relaxed">“把这里的文字改成深蓝色，并且让背景的星星更亮一些。”</p>
            </div>
          </div>
        </div>
        <div className="order-1 lg:order-2">
          <motion.div initial={{ opacity: 0, x: 20 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }}>
            <h2 className="mb-8 text-4xl font-bold tracking-tight">像和设计师沟通一样修改</h2>
            <p className="mb-10 text-lg leading-relaxed text-slate-400">
              不再需要反复重抽。通过带标注的局部修改与自然语言反馈，你可以精准控制海报的每一个细节。AI 会理解你的意图，保留好的部分，只修改你指出的地方。
            </p>
            <ul className="space-y-4">
              {[
                '支持编号框与箭头类标注精修',
                'AI 自动提供 4-6 个创意迭代建议',
                '一次生成多个 Variation 供对比',
                '保留版式结构，仅做视觉增量调整'
              ].map((item, index) => (
                <li key={index} className="flex items-center gap-3">
                  <CheckCircle2 className={brandTextClass} size={20} />
                  <span className="font-medium">{item}</span>
                </li>
              ))}
            </ul>
          </motion.div>
        </div>
      </div>
    </div>
  </section>
);

const StyleReferenceSection: React.FC = () => (
  <section className="overflow-hidden bg-slate-50 py-32">
    <div className="mx-auto max-w-7xl px-6">
      <div className="grid items-center gap-20 lg:grid-cols-2">
        <div>
          <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}>
            <h2 className="mb-8 text-4xl font-bold tracking-tight text-slate-900">像参考过往海报一样延续风格</h2>
            <p className="mb-10 text-lg leading-relaxed text-slate-500">
              把你过去做过的海报、主视觉或品牌 campaign 作品交给 Posterize。系统会自动理解其中的版式习惯、色彩关系与视觉语气，在新需求里延续同一套风格，而不是每次都从零开始。
            </p>
            <ul className="space-y-4">
              {[
                '参考历史海报，延续品牌语气与视觉识别',
                '自动提取常用色彩、标题层级与构图偏好',
                '新主题也能保持同系列作品的一致感',
                '适合活动续作、品牌系列海报与长期内容运营'
              ].map((item, index) => (
                <li key={index} className="flex items-center gap-3">
                  <CheckCircle2 className={brandTextClass} size={20} />
                  <span className="font-medium text-slate-700">{item}</span>
                </li>
              ))}
            </ul>
          </motion.div>
        </div>

        <div className="relative">
          <div className="grid items-start gap-6 md:grid-cols-2">
            <div className="flex justify-center">
              <div className="w-[220px]">
                <div className="aspect-[3/4] overflow-hidden bg-white">
                  <img src={styleReferencePast} alt="过往品牌海报参考" className="h-full w-full bg-white object-contain" referrerPolicy="no-referrer" />
                </div>
              </div>
            </div>

            <div className="flex flex-col items-center">
              <div className="relative w-[220px]">
                <div className={`absolute -top-4 right-0 rounded-full px-4 py-2 text-xs font-bold whitespace-nowrap text-white shadow-lg ${brandBgClass}`}>
                  保持同系列风格
                </div>
                <div className="aspect-[3/4] overflow-hidden bg-white">
                  <img src={styleReferenceContinuation} alt="延续同品牌风格生成的新视觉" className="h-full w-full bg-white object-contain" referrerPolicy="no-referrer" />
                </div>
              </div>
              <div className="mt-5 max-w-sm rounded-2xl border border-slate-200 bg-white/70 p-4">
                <p className="mb-2 text-[11px] uppercase tracking-[0.2em] text-slate-400">AI Learned Style</p>
                <p className="text-sm leading-relaxed text-slate-700">
                  已继承暖金色调、产品聚焦和高级留白感，在新的传播场景里依然保持同一品牌气质。
                </p>
              </div>
            </div>
          </div>
          <div className="absolute -top-10 right-10 -z-10 h-56 w-56 rounded-full bg-[#ea4c89]/10 blur-3xl" />
        </div>
      </div>
    </div>
  </section>
);

const AssetSection: React.FC = () => (
  <section id="assets" className="bg-white py-32">
    <div className="mx-auto max-w-7xl px-6">
      <div className="mb-20 text-center">
        <h2 className="mb-4 text-4xl font-bold tracking-tight text-slate-900">你的私有视觉资产库</h2>
        <p className="mx-auto max-w-2xl text-slate-500">沉淀品牌基因，让 AI 成为最懂你品牌的设计助理。</p>
      </div>

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
        {[
          { title: 'Reference Styles', count: '24+ 风格图', icon: <Palette /> },
          { title: 'Font References', count: '12+ 字体参考', icon: <PenTool /> },
          { title: 'Logo Assets', count: '8+ 品牌标识', icon: <Layers /> },
          { title: 'Primary Colors', count: '16+ 色彩组合', icon: <Sparkles /> }
        ].map((asset, index) => (
          <div key={index} className={`${cardClass} flex flex-col items-center p-8 text-center`}>
            <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-slate-50 text-slate-400">
              {asset.icon}
            </div>
            <h4 className="mb-2 text-lg font-bold text-slate-900">{asset.title}</h4>
            <p className="mb-6 text-sm text-slate-400">{asset.count}</p>
            <button type="button" className={`flex items-center gap-1 text-sm font-bold ${brandTextClass}`}>
              管理资产 <ChevronRight size={16} />
            </button>
          </div>
        ))}
      </div>
    </div>
  </section>
);

const UseCases: React.FC = () => (
  <section id="cases" className="bg-slate-50 py-32">
    <div className="mx-auto max-w-7xl px-6">
      <div className="mb-20 text-center">
        <h2 className="mb-4 text-4xl font-bold tracking-tight text-slate-900">赋能多元创作场景</h2>
        <p className="mx-auto max-w-2xl text-slate-500">无论是校园活动还是品牌传播，Posterize 都能提供专业级的视觉支持。</p>
      </div>

      <div className="grid gap-8 md:grid-cols-3">
        {[
          { title: '校园活动', desc: '社团招新、讲座海报、校园文化节宣传，快速产出系列视觉。', image: useCaseImages[0] },
          { title: '品牌传播', desc: '节日海报、新品发布、社交媒体 KV，保持品牌调性高度统一。', image: useCaseImages[1] },
          { title: '演出展览', desc: '音乐会、艺术展、市集海报，AI 辅助创意策划，捕捉艺术灵感。', image: useCaseImages[2] }
        ].map((item) => (
          <div key={item.title} className="rounded-3xl border border-slate-100 bg-white p-10 shadow-sm">
            <h4 className="mb-4 text-xl font-bold text-slate-900">{item.title}</h4>
            <p className="mb-8 text-sm leading-relaxed text-slate-500">{item.desc}</p>
            <div className="aspect-video overflow-hidden rounded-2xl bg-slate-100">
              <img src={item.image.src} alt={item.image.alt} className="h-full w-full bg-white object-contain" referrerPolicy="no-referrer" />
            </div>
          </div>
        ))}
      </div>
    </div>
  </section>
);

const Footer: React.FC = () => (
  <footer className="border-t border-slate-100 bg-white py-20">
    <div className="mx-auto max-w-7xl px-6">
      <div className="mb-16 flex flex-col items-start justify-between gap-12 md:flex-row">
        <div className="max-w-xs">
          <div className="mb-6 flex items-center gap-2">
            <span className="text-lg font-bold text-slate-900">Posterize</span>
          </div>
          <p className="text-sm leading-relaxed text-slate-500">
            专业的 AI 海报生产系统。让创意不再受限于技能，让每一份需求都能转化为精美的视觉作品。
          </p>
        </div>

        <div className="grid grid-cols-2 gap-12 sm:grid-cols-3">
          <div>
            <h5 className="mb-6 font-bold text-slate-900">产品</h5>
            <ul className="space-y-4 text-sm text-slate-500">
              <li><a href="#features" className="hover:text-slate-900">功能特色</a></li>
              <li><a href="#workflow" className="hover:text-slate-900">工作流</a></li>
              <li><a href="#cases" className="hover:text-slate-900">价格方案</a></li>
            </ul>
          </div>
          <div>
            <h5 className="mb-6 font-bold text-slate-900">资源</h5>
            <ul className="space-y-4 text-sm text-slate-500">
              <li><a href="#assets" className="hover:text-slate-900">设计指南</a></li>
              <li><a href="#cases" className="hover:text-slate-900">案例展示</a></li>
              <li><a href="#workflow" className="hover:text-slate-900">帮助中心</a></li>
            </ul>
          </div>
          <div>
            <h5 className="mb-6 font-bold text-slate-900">公司</h5>
            <ul className="space-y-4 text-sm text-slate-500">
              <li><a href="#" className="hover:text-slate-900">关于我们</a></li>
              <li><a href="#" className="hover:text-slate-900">联系我们</a></li>
              <li><a href="#" className="hover:text-slate-900">隐私政策</a></li>
            </ul>
          </div>
        </div>
      </div>

      <div className="flex flex-col items-center justify-between gap-6 border-t border-slate-100 pt-8 md:flex-row">
        <p className="text-xs text-slate-400">© 2026 Posterize. All rights reserved.</p>
        <div className="flex gap-6" />
      </div>
    </div>
  </footer>
);

const FinalCta: React.FC<LandingPageProps> = ({ onStartCreating }) => (
  <section className="px-6 py-32">
    <div className={`relative mx-auto max-w-5xl overflow-hidden rounded-[3rem] p-12 text-center text-white shadow-2xl md:p-20 ${brandBgClass}`}>
      <div className="relative z-10">
        <h2 className="mb-8 text-4xl font-bold md:text-6xl">准备好开启你的<br />AI 创作之旅了吗？</h2>
        <p className="mx-auto mb-12 max-w-xl text-lg text-white/80">
          加入数千名创作者，使用 Posterize 打造属于你的品牌视觉资产。
        </p>
        <button
          type="button"
          onClick={onStartCreating}
          className="rounded-full bg-white px-10 py-4 text-xl font-bold text-[#ea4c89] shadow-xl transition-all hover:bg-slate-50"
        >
          免费开始使用
        </button>
      </div>
      <div className="absolute -top-20 -left-20 h-64 w-64 rounded-full bg-white/10 blur-3xl" />
      <div className="absolute -right-20 -bottom-20 h-64 w-64 rounded-full bg-white/10 blur-3xl" />
    </div>
  </section>
);

const LandingPage: React.FC<LandingPageProps> = ({ onStartCreating }) => {
  return (
    <div className="min-h-screen bg-[#f8f9fb] font-['Inter'] text-slate-900 selection:bg-[#ea4c89] selection:text-white">
      <NavBar onStartCreating={onStartCreating} />
      <main>
        <Hero onStartCreating={onStartCreating} />
        <Features />
        <WorkflowSection />
        <RefinementSection />
        <StyleReferenceSection />
        <AssetSection />
        <UseCases />
        <FinalCta onStartCreating={onStartCreating} />
      </main>
      <Footer />
    </div>
  );
};

export default LandingPage;

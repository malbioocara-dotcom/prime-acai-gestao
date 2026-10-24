import {
  createIcons,
  // usados pelas telas de autenticação
  Store,
  Check,
  Eye,
  EyeOff,
  Mail,
  Lock,
  User,
  ArrowLeft,
  AlertCircle,
  CheckCircle2,
  Info,
  // opções comuns para `config.marca.icone`
  Building2,
  ShoppingCart,
  Package,
  Users,
  Wallet,
  Coffee,
  Utensils,
  IceCreamCone,
  Truck,
  Briefcase,
  Heart,
  Lightbulb,
} from 'lucide'

/**
 * Ícones disponíveis nas telas de autenticação.
 *
 * Importamos apenas os que usamos para manter o bundle pequeno (importar
 * `icons` traria a biblioteca inteira, ~1300 ícones). O host pode registrar
 * outros ícones do Lucide chamando `renderIcons` com o próprio `iconSet` — mas
 * para os ícones do login, esta lista basta.
 */
export const iconSet = {
  Store,
  Check,
  Eye,
  EyeOff,
  Mail,
  Lock,
  User,
  ArrowLeft,
  AlertCircle,
  CheckCircle2,
  Info,
  Building2,
  ShoppingCart,
  Package,
  Users,
  Wallet,
  Coffee,
  Utensils,
  IceCreamCone,
  Truck,
  Briefcase,
  Heart,
  Lightbulb,
}

/**
 * Substitui todo `<i data-lucide="nome"></i>` dentro de `root` pelo SVG do ícone.
 * Elementos já convertidos são trocados no DOM, então chamadas repetidas não
 * reprocessam os mesmos ícones.
 */
export function renderIcons(root = document) {
  createIcons({
    icons: iconSet,
    nameAttr: 'data-lucide',
    attrs: { 'stroke-width': 1.75, 'aria-hidden': 'true' },
    root,
  })
}

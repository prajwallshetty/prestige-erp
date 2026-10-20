"use client";

import { useCallback, useMemo, useRef, useState } from "react";

import type { SearchableOption } from "@/components/ui/searchable-select";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatCurrency } from "@/lib/money";

export interface PickerVariant {
  id: string;
  name: string;
  sku: string;
  sellingPrice: number;
  stock?: number | null;
}

/** A catalogue product as the quotation pickers need it — one product master, no copies. */
export interface PickerProduct {
  id: string;
  name: string;
  subName?: string | null;
  sku: string;
  sellingPrice: number;
  gstRate: number;
  trackSerials: boolean;
  unit?: string | null;
  brand?: string | null;
  category?: string | null;
  attributes?: { name: string; value: string }[];
  variants?: PickerVariant[];
  stock?: number | null;
}

const attr = (product: PickerProduct, ...names: string[]) =>
  product.attributes?.find((a) => names.includes(a.name.toLowerCase()))?.value;

export function productOption(product: PickerProduct): SearchableOption {
  const size = attr(product, "size");
  const finish = attr(product, "finish", "surface");
  const bits = [product.brand, product.name, product.subName].filter(Boolean);
  const hint = [
    product.sku,
    size,
    finish,
    product.category,
    formatCurrency(product.sellingPrice) + (product.unit ? `/${product.unit}` : ""),
    product.stock != null ? `${product.stock} in stock` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return { value: product.id, label: bits.join(" · "), hint };
}

/**
 * Server-side product search with a cache of everything loaded so far, so
 * lines already added keep resolving while the picker's list changes.
 */
export function useProductSearch(initial: PickerProduct[] = []) {
  const [products, setProducts] = useState<PickerProduct[]>(initial);
  const [results, setResults] = useState<string[] | null>(null);
  const latest = useRef(0);

  const merge = useCallback((incoming: PickerProduct[]) => {
    setProducts((current) => {
      const map = new Map(current.map((p) => [p.id, p]));
      for (const p of incoming) map.set(p.id, p);
      return [...map.values()];
    });
  }, []);

  const search = useCallback(
    async (query: string) => {
      const ticket = ++latest.current;
      try {
        const response = await fetch(`/api/products${query ? `?q=${encodeURIComponent(query)}` : ""}`);
        if (!response.ok) return;
        const data = (await response.json()) as { products?: PickerProduct[] };
        if (ticket !== latest.current) return; // a newer search superseded this one
        const found = data.products ?? [];
        merge(found);
        setResults(found.map((p) => p.id));
      } catch {
        /* keep the previous list */
      }
    },
    [merge],
  );

  const hydrate = useCallback(
    async (ids: string[]) => {
      if (ids.length === 0) return;
      try {
        const response = await fetch(`/api/products?ids=${ids.join(",")}`);
        if (!response.ok) return;
        merge(((await response.json()) as { products?: PickerProduct[] }).products ?? []);
      } catch {
        /* lines fall back to their saved values */
      }
    },
    [merge],
  );

  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  /** Options for the picker: the current search results plus every product already chosen on a line. */
  const optionsFor = useCallback(
    (pinned: string[]) => {
      const keep = new Set([...(results ?? products.map((p) => p.id)), ...pinned]);
      return products.filter((p) => keep.has(p.id)).map(productOption);
    },
    [products, results],
  );

  return { products, byId, optionsFor, search, hydrate, merge };
}

/** Variant (size / finish) chooser, shown only for products that have variants. */
export function VariantSelect({
  product,
  value,
  onChange,
}: {
  product: PickerProduct | undefined;
  value: string;
  onChange: (variant: PickerVariant | null) => void;
}) {
  if (!product?.variants?.length) return null;
  return (
    <div className="min-w-48 flex-1">
      <Label className="text-xs text-muted-foreground">Size / variant *</Label>
      <Select
        value={value || "__base"}
        onValueChange={(next) => onChange(next === "__base" ? null : (product.variants!.find((v) => v.id === next) ?? null))}
      >
        <SelectTrigger className="h-8" aria-label="Variant">
          <SelectValue placeholder="Choose variant" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__base">{product.name} (base)</SelectItem>
          {product.variants.map((variant) => (
            <SelectItem key={variant.id} value={variant.id}>
              {variant.name} · {formatCurrency(variant.sellingPrice || product.sellingPrice)}
              {variant.stock != null ? ` · ${variant.stock} in stock` : ""}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

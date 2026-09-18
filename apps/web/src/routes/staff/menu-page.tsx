import { useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import {
  createAddonRequestSchema,
  createCategoryRequestSchema,
  createItemRequestSchema,
  createVariantRequestSchema,
  type CreateAddonRequest,
  type CreateCategoryRequest,
  type CreateItemRequest,
  type CreateVariantRequest,
  type MenuAddon,
  type MenuCategory,
  type MenuItem,
} from '@rewardbite/contracts';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { ApiError } from '@/lib/api-client';
import { Can } from '@/features/auth/can';
import {
  useCreateAddon,
  useCreateCategory,
  useCreateItem,
  useCreateVariant,
  useDeleteAddon,
  useDeleteCategory,
  useDeleteItem,
  useDeleteVariant,
  useMenu,
  usePatchAddon,
  usePatchCategory,
  usePatchItem,
  useReorderMenu,
  useUpdateItemAvailability,
  useUpdateVariantAvailability,
} from '@/features/menu/use-menu';

function describeError(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  return 'Something went wrong. Please try again.';
}

function formatPaise(paise: number): string {
  return `₹${(paise / 100).toFixed(2)}`;
}

export function MenuPage(): JSX.Element {
  const menuQuery = useMenu();

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold">Menu</h1>

      {menuQuery.isLoading && <p className="text-muted-foreground">Loading menu…</p>}

      {menuQuery.isError && (
        <div className="flex items-center gap-3">
          <p className="text-red-600">Could not load the menu.</p>
          <Button size="sm" variant="outline" onClick={() => void menuQuery.refetch()}>
            Retry
          </Button>
        </div>
      )}

      {menuQuery.data && (
        <>
          <Can permission="menu.manage">
            <CreateCategoryForm />
          </Can>

          {menuQuery.data.data.categories.length === 0 && (
            <p className="text-muted-foreground">No categories yet. Add one above.</p>
          )}

          <div className="flex flex-col gap-4">
            {menuQuery.data.data.categories.map((category, index) => (
              <CategoryCard
                key={category.id}
                category={category}
                addonCatalog={menuQuery.data.data.addons}
                allCategoryIds={menuQuery.data.data.categories.map((c) => c.id)}
                index={index}
              />
            ))}
          </div>

          <Can permission="menu.manage">
            <AddonCatalogCard addons={menuQuery.data.data.addons} />
          </Can>
        </>
      )}
    </div>
  );
}

function CreateCategoryForm(): JSX.Element {
  const createCategory = useCreateCategory();
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<CreateCategoryRequest>({ resolver: zodResolver(createCategoryRequestSchema) });

  const onSubmit = handleSubmit((values) => {
    createCategory.mutate(values, { onSuccess: () => reset() });
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Add a category</CardTitle>
      </CardHeader>
      <CardContent>
        <form className="flex items-end gap-4" onSubmit={onSubmit} noValidate>
          <div className="flex flex-1 flex-col gap-1.5">
            <Label htmlFor="category-name">Name</Label>
            <Input id="category-name" {...register('name')} aria-invalid={Boolean(errors.name)} />
            {errors.name && <p className="text-sm text-red-600">{errors.name.message}</p>}
          </div>
          <Button type="submit" disabled={createCategory.isPending}>
            {createCategory.isPending ? 'Adding…' : 'Add category'}
          </Button>
        </form>
        {createCategory.error && (
          <p role="alert" className="mt-2 text-sm text-red-600">
            {describeError(createCategory.error)}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function CategoryCard({
  category,
  addonCatalog,
  allCategoryIds,
  index,
}: {
  category: MenuCategory;
  addonCatalog: MenuAddon[];
  allCategoryIds: string[];
  index: number;
}): JSX.Element {
  const patchCategory = usePatchCategory();
  const deleteCategory = useDeleteCategory();
  const reorder = useReorderMenu();
  const [error, setError] = useState<string | null>(null);

  const move = (direction: -1 | 1): void => {
    const next = [...allCategoryIds];
    const target = index + direction;
    if (target < 0 || target >= next.length) return;
    const [moved] = next.splice(index, 1);
    next.splice(target, 0, moved as string);
    reorder.mutate({ categoryIds: next }, { onError: (err) => setError(describeError(err)) });
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CardTitle>{category.name}</CardTitle>
            <Badge variant={category.isActive ? 'default' : 'secondary'}>
              {category.isActive ? 'Active' : 'Inactive'}
            </Badge>
          </div>
          <Can permission="menu.manage">
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" onClick={() => move(-1)} disabled={index === 0}>
                ↑
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => move(1)}
                disabled={index === allCategoryIds.length - 1}
              >
                ↓
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  patchCategory.mutate(
                    { id: category.id, isActive: !category.isActive },
                    { onError: (err) => setError(describeError(err)) },
                  )
                }
                disabled={patchCategory.isPending}
              >
                {category.isActive ? 'Deactivate' : 'Activate'}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  deleteCategory.mutate(category.id, {
                    onError: (err) => setError(describeError(err)),
                  })
                }
                disabled={deleteCategory.isPending || category.items.length > 0}
                title={category.items.length > 0 ? 'This category still has items' : undefined}
              >
                Delete
              </Button>
            </div>
          </Can>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {error && (
          <p role="alert" className="text-xs text-red-600">
            {error}
          </p>
        )}

        {category.items.length === 0 && (
          <p className="text-sm text-muted-foreground">No items in this category yet.</p>
        )}

        <div className="flex flex-col gap-3">
          {category.items.map((item) => (
            <ItemRow key={item.id} item={item} addonCatalog={addonCatalog} />
          ))}
        </div>

        <Can permission="menu.manage">
          <CreateItemForm categoryId={category.id} />
        </Can>
      </CardContent>
    </Card>
  );
}

function ItemRow({
  item,
  addonCatalog,
}: {
  item: MenuItem;
  addonCatalog: MenuAddon[];
}): JSX.Element {
  const patchItem = usePatchItem();
  const deleteItem = useDeleteItem();
  const updateAvailability = useUpdateItemAvailability();
  const createVariant = useCreateVariant();
  const [error, setError] = useState<string | null>(null);
  const [showVariantForm, setShowVariantForm] = useState(false);
  const [showAddonPicker, setShowAddonPicker] = useState(false);

  const {
    register: registerVariant,
    handleSubmit: handleSubmitVariant,
    reset: resetVariant,
    formState: { errors: variantErrors },
  } = useForm<CreateVariantRequest>({
    resolver: zodResolver(createVariantRequestSchema),
    defaultValues: { itemId: item.id },
  });

  const onSubmitVariant = handleSubmitVariant((values) => {
    createVariant.mutate(
      { ...values, itemId: item.id },
      {
        onSuccess: () => {
          resetVariant({ itemId: item.id, name: '', pricePaise: 0 });
          setShowVariantForm(false);
        },
        onError: (err) => setError(describeError(err)),
      },
    );
  });

  const toggleAddon = (addonId: string, checked: boolean): void => {
    const current = item.addons.map((a) => ({ addonId: a.addonId, maxQty: a.maxQty }));
    const next = checked
      ? [...current, { addonId, maxQty: 1 }]
      : current.filter((a) => a.addonId !== addonId);
    patchItem.mutate(
      { id: item.id, addons: next },
      { onError: (err) => setError(describeError(err)) },
    );
  };

  return (
    <div className="rounded-md border border-border p-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="font-medium">{item.name}</span>
          {item.vegFlag && <Badge variant="secondary">{item.vegFlag}</Badge>}
          <Badge variant={item.isActive ? 'default' : 'secondary'}>
            {item.isActive ? 'Active' : 'Inactive'}
          </Badge>
          <Badge variant={item.isAvailable ? 'default' : 'secondary'}>
            {item.isAvailable ? 'Available' : 'Unavailable'}
          </Badge>
        </div>
        <span className="text-sm text-muted-foreground">
          {item.basePricePaise !== null
            ? formatPaise(item.basePricePaise)
            : item.variants.length > 0
              ? `From ${formatPaise(Math.min(...item.variants.map((v) => v.pricePaise)))}`
              : 'No price set'}
        </span>
      </div>

      {error && (
        <p role="alert" className="mt-1 text-xs text-red-600">
          {error}
        </p>
      )}

      <Can permission="menu.availability.update">
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              updateAvailability.mutate(
                { id: item.id, isAvailable: !item.isAvailable },
                { onError: (err) => setError(describeError(err)) },
              )
            }
            disabled={updateAvailability.isPending}
          >
            Mark {item.isAvailable ? 'unavailable' : 'available'}
          </Button>
        </div>
      </Can>

      <Can permission="menu.manage">
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => setShowVariantForm((v) => !v)}>
            {showVariantForm ? 'Cancel' : 'Add variant'}
          </Button>
          <Button size="sm" variant="outline" onClick={() => setShowAddonPicker((v) => !v)}>
            {showAddonPicker ? 'Hide add-ons' : 'Manage add-ons'}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              deleteItem.mutate(item.id, { onError: (err) => setError(describeError(err)) })
            }
            disabled={deleteItem.isPending}
          >
            Delete item
          </Button>
        </div>

        {showVariantForm && (
          <form className="mt-2 flex items-end gap-2" onSubmit={onSubmitVariant} noValidate>
            <div className="flex flex-col gap-1">
              <Label htmlFor={`variant-name-${item.id}`}>Variant name</Label>
              <Input id={`variant-name-${item.id}`} {...registerVariant('name')} />
              {variantErrors.name && (
                <p className="text-xs text-red-600">{variantErrors.name.message}</p>
              )}
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor={`variant-price-${item.id}`}>Price (paise)</Label>
              <Input
                id={`variant-price-${item.id}`}
                type="number"
                {...registerVariant('pricePaise', { valueAsNumber: true })}
              />
            </div>
            <Button type="submit" size="sm" disabled={createVariant.isPending}>
              Add
            </Button>
          </form>
        )}

        {showAddonPicker && (
          <div className="mt-2 flex flex-col gap-1 rounded-md border border-border p-2">
            {addonCatalog.length === 0 && (
              <p className="text-xs text-muted-foreground">No add-ons in the catalog yet.</p>
            )}
            {addonCatalog.map((addon) => {
              const attached = item.addons.some((a) => a.addonId === addon.id);
              return (
                <label key={addon.id} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={attached}
                    onChange={(e) => toggleAddon(addon.id, e.target.checked)}
                  />
                  {addon.name} ({formatPaise(addon.pricePaise)})
                </label>
              );
            })}
          </div>
        )}
      </Can>

      {item.variants.length > 0 && (
        <ul className="mt-2 flex flex-col gap-1 border-t border-border pt-2">
          {item.variants.map((variant) => (
            <VariantRow key={variant.id} variant={variant} onError={setError} />
          ))}
        </ul>
      )}
    </div>
  );
}

function VariantRow({
  variant,
  onError,
}: {
  variant: MenuItem['variants'][number];
  onError: (message: string) => void;
}): JSX.Element {
  const updateAvailability = useUpdateVariantAvailability();
  const deleteVariant = useDeleteVariant();

  return (
    <li className="flex items-center justify-between text-sm">
      <span>
        {variant.name} — {formatPaise(variant.pricePaise)}{' '}
        <Badge variant={variant.isAvailable ? 'default' : 'secondary'}>
          {variant.isAvailable ? 'Available' : 'Unavailable'}
        </Badge>
      </span>
      <div className="flex items-center gap-2">
        <Can permission="menu.availability.update">
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              updateAvailability.mutate(
                { id: variant.id, isAvailable: !variant.isAvailable },
                { onError: (err) => onError(describeError(err)) },
              )
            }
          >
            Toggle
          </Button>
        </Can>
        <Can permission="menu.manage">
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              deleteVariant.mutate(variant.id, { onError: (err) => onError(describeError(err)) })
            }
          >
            Delete
          </Button>
        </Can>
      </div>
    </li>
  );
}

function CreateItemForm({ categoryId }: { categoryId: string }): JSX.Element {
  const createItem = useCreateItem();
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<CreateItemRequest>({
    resolver: zodResolver(createItemRequestSchema),
    defaultValues: { categoryId },
  });

  const onSubmit = handleSubmit((values) => {
    createItem.mutate(
      { ...values, categoryId },
      { onSuccess: () => reset({ categoryId, name: '', basePricePaise: undefined }) },
    );
  });

  return (
    <form
      className="flex flex-wrap items-end gap-3 border-t border-border pt-3"
      onSubmit={onSubmit}
      noValidate
    >
      <div className="flex flex-col gap-1">
        <Label htmlFor={`item-name-${categoryId}`}>Item name</Label>
        <Input
          id={`item-name-${categoryId}`}
          {...register('name')}
          aria-invalid={Boolean(errors.name)}
        />
        {errors.name && <p className="text-xs text-red-600">{errors.name.message}</p>}
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor={`item-price-${categoryId}`}>Base price (paise)</Label>
        <Input
          id={`item-price-${categoryId}`}
          type="number"
          {...register('basePricePaise', { valueAsNumber: true })}
        />
        <p className="text-xs text-muted-foreground">Leave blank for a variant-only item.</p>
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor={`item-veg-${categoryId}`}>Veg flag</Label>
        <Select id={`item-veg-${categoryId}`} {...register('vegFlag')}>
          <option value="">—</option>
          <option value="VEG">Veg</option>
          <option value="NON_VEG">Non-veg</option>
          <option value="EGG">Egg</option>
        </Select>
      </div>
      <Button type="submit" size="sm" disabled={createItem.isPending}>
        {createItem.isPending ? 'Adding…' : 'Add item'}
      </Button>
      {createItem.error && (
        <p role="alert" className="w-full text-xs text-red-600">
          {describeError(createItem.error)}
        </p>
      )}
    </form>
  );
}

function AddonRow({
  addon,
  onError,
}: {
  addon: MenuAddon;
  onError: (message: string) => void;
}): JSX.Element {
  const patchAddon = usePatchAddon();
  const deleteAddon = useDeleteAddon();
  const [isEditing, setIsEditing] = useState(false);
  const { register, handleSubmit, reset } = useForm<{ name: string; pricePaise: number }>({
    defaultValues: { name: addon.name, pricePaise: addon.pricePaise },
  });

  const onSubmit = handleSubmit((values) => {
    patchAddon.mutate(
      { id: addon.id, ...values },
      {
        onSuccess: () => setIsEditing(false),
        onError: (err) => onError(describeError(err)),
      },
    );
  });

  if (isEditing) {
    return (
      <form className="flex items-end gap-2 text-sm" onSubmit={onSubmit} noValidate>
        <Input className="w-40" {...register('name')} aria-label="Add-on name" />
        <Input
          className="w-28"
          type="number"
          {...register('pricePaise', { valueAsNumber: true })}
          aria-label="Add-on price in paise"
        />
        <Button type="submit" size="sm" disabled={patchAddon.isPending}>
          Save
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => {
            reset({ name: addon.name, pricePaise: addon.pricePaise });
            setIsEditing(false);
          }}
        >
          Cancel
        </Button>
      </form>
    );
  }

  return (
    <div className="flex items-center justify-between text-sm">
      <span>
        {addon.name} — {formatPaise(addon.pricePaise)}{' '}
        <Badge variant={addon.isAvailable ? 'default' : 'secondary'}>
          {addon.isAvailable ? 'Available' : 'Unavailable'}
        </Badge>
      </span>
      <div className="flex items-center gap-2">
        <Button size="sm" variant="outline" onClick={() => setIsEditing(true)}>
          Edit
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() =>
            deleteAddon.mutate(addon.id, { onError: (err) => onError(describeError(err)) })
          }
        >
          Delete
        </Button>
      </div>
    </div>
  );
}

function AddonCatalogCard({ addons }: { addons: MenuAddon[] }): JSX.Element {
  const createAddon = useCreateAddon();
  const [error, setError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<CreateAddonRequest>({ resolver: zodResolver(createAddonRequestSchema) });

  const onSubmit = handleSubmit((values) => {
    createAddon.mutate(values, { onSuccess: () => reset() });
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Add-on catalog</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {addons.length === 0 && <p className="text-sm text-muted-foreground">No add-ons yet.</p>}
        {addons.map((addon) => (
          <AddonRow key={addon.id} addon={addon} onError={setError} />
        ))}

        {error && (
          <p role="alert" className="text-xs text-red-600">
            {error}
          </p>
        )}

        <form
          className="flex items-end gap-3 border-t border-border pt-3"
          onSubmit={onSubmit}
          noValidate
        >
          <div className="flex flex-col gap-1">
            <Label htmlFor="addon-name">Name</Label>
            <Input id="addon-name" {...register('name')} aria-invalid={Boolean(errors.name)} />
            {errors.name && <p className="text-xs text-red-600">{errors.name.message}</p>}
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="addon-price">Price (paise)</Label>
            <Input
              id="addon-price"
              type="number"
              {...register('pricePaise', { valueAsNumber: true })}
            />
          </div>
          <Button type="submit" size="sm" disabled={createAddon.isPending}>
            {createAddon.isPending ? 'Adding…' : 'Add add-on'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

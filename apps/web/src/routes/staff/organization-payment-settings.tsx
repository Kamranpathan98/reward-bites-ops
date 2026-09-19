import { useRef, useState, type FormEvent } from 'react';
import {
  patchOrganizationPaymentSettingsRequestSchema,
  type OrganizationPaymentSettings,
  type PatchOrganizationPaymentSettingsRequest,
} from '@rewardbite/contracts';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useMe } from '@/features/auth/use-auth';
import {
  useOrganizationSettings,
  useUpdateOrganizationSettings,
} from '@/features/settings/use-organization-settings';
import { ApiError } from '@/lib/api-client';

interface Draft {
  cashEnabled?: boolean;
  upiEnabled?: boolean;
  upiId?: string;
  upiReferenceRequired?: boolean;
}

const checkboxClass =
  'mt-0.5 h-5 w-5 shrink-0 cursor-pointer accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-60';

/**
 * Payment settings. Backend authorization is authoritative (`settings.read` to
 * load, `settings.payments.manage` to save); the permission checks here only
 * decide whether to render editable controls, a read-only view, or nothing.
 */
export function OrganizationPaymentSettingsPage(): JSX.Element {
  const { data: me, isLoading: meLoading, isError: meError } = useMe();
  const canRead = me?.permissions.includes('settings.read') ?? false;
  const canManage = me?.permissions.includes('settings.payments.manage') ?? false;

  const settingsQuery = useOrganizationSettings(canRead);
  const update = useUpdateOrganizationSettings();

  const [draft, setDraft] = useState<Draft>({});
  const [submitted, setSubmitted] = useState(false);
  const [saved, setSaved] = useState(false);
  const upiIdRef = useRef<HTMLInputElement>(null);

  if (meLoading) return <p className="text-muted-foreground">Loading payment settings…</p>;

  if (meError) {
    return (
      <p role="alert" className="text-red-600">
        Could not load your account. Reload the page and try again.
      </p>
    );
  }

  if (!canRead) {
    return (
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold">Payment settings</h1>
        <p className="text-muted-foreground">You don&apos;t have access to payment settings.</p>
      </div>
    );
  }

  if (settingsQuery.isPending) {
    return <p className="text-muted-foreground">Loading payment settings…</p>;
  }

  if (settingsQuery.isError) {
    return (
      <div className="flex flex-col items-start gap-2">
        <p role="alert" className="text-red-600">
          Could not load payment settings.
        </p>
        <Button size="sm" variant="outline" onClick={() => void settingsQuery.refetch()}>
          Retry
        </Button>
      </div>
    );
  }

  const server = settingsQuery.data.data;
  const values = {
    cashEnabled: draft.cashEnabled ?? server.cashEnabled,
    upiEnabled: draft.upiEnabled ?? server.upiEnabled,
    upiId: draft.upiId ?? server.upiId ?? '',
    upiReferenceRequired: draft.upiReferenceRequired ?? server.upiReferenceRequired,
  };
  const changes = diff(server, values);
  const hasChanges = Object.keys(changes).length > 0;

  const methodsError =
    !values.cashEnabled && !values.upiEnabled ? 'At least one payment method must stay on.' : null;
  // Length / control-character rules come from the API contract so client and server cannot drift.
  const upiIdShape = patchOrganizationPaymentSettingsRequestSchema.safeParse({
    upiId: values.upiId,
  });
  const upiIdError = !upiIdShape.success
    ? (upiIdShape.error.issues[0]?.message ?? 'Enter a valid UPI ID.')
    : values.upiEnabled && !values.upiId.trim()
      ? 'Enter a UPI ID before turning UPI on.'
      : null;

  const serverError = update.error
    ? update.error instanceof ApiError
      ? update.error.message
      : 'Could not save payment settings. Try again.'
    : null;
  const shownMethodsError = submitted ? methodsError : null;
  const formError = shownMethodsError ?? serverError;
  const methodsDescribedBy = (hint: string): string =>
    shownMethodsError ? `${hint} form-error` : hint;
  const shownUpiIdError = submitted ? upiIdError : null;

  function edit(next: Draft): void {
    setDraft((d) => withoutServerValues({ ...d, ...next }, server));
    setSaved(false);
    update.reset();
  }

  function onSubmit(event: FormEvent): void {
    event.preventDefault();
    setSubmitted(true);
    setSaved(false);
    if (methodsError) return;
    if (upiIdError) {
      upiIdRef.current?.focus();
      return;
    }
    update.mutate(changes, {
      onSuccess: () => {
        setDraft({});
        setSubmitted(false);
        setSaved(true);
      },
    });
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex max-w-2xl flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold">Payment settings</h1>
        <p className="text-sm text-muted-foreground">
          Choose how customers can pay. Changes apply to future payments only; existing bills and
          payments are not affected.
        </p>
      </div>

      {!canManage && (
        <p className="rounded border border-border bg-surface-muted px-3 py-2 text-sm text-muted-foreground">
          You can view these settings but don&apos;t have permission to change them.
        </p>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Payment methods</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <div className="flex items-start gap-3">
            <input
              id="cash-enabled"
              type="checkbox"
              className={checkboxClass}
              checked={values.cashEnabled}
              disabled={!canManage}
              aria-describedby={methodsDescribedBy('cash-enabled-hint')}
              onChange={(e) => edit({ cashEnabled: e.target.checked })}
            />
            <div className="flex flex-col gap-1">
              <Label htmlFor="cash-enabled">Cash payments</Label>
              <p id="cash-enabled-hint" className="text-sm text-muted-foreground">
                Accept cash at the counter.
              </p>
            </div>
          </div>

          <div className="flex items-start gap-3">
            <input
              id="upi-enabled"
              type="checkbox"
              className={checkboxClass}
              checked={values.upiEnabled}
              disabled={!canManage}
              aria-describedby={methodsDescribedBy('upi-enabled-hint')}
              onChange={(e) => edit({ upiEnabled: e.target.checked })}
            />
            <div className="flex flex-col gap-1">
              <Label htmlFor="upi-enabled">UPI payments</Label>
              <p id="upi-enabled-hint" className="text-sm text-muted-foreground">
                Accept UPI payments to the ID below.
              </p>
            </div>
          </div>

          <div className="flex flex-col gap-1.5 border-t border-border pt-5">
            <Label htmlFor="upi-id">UPI ID</Label>
            <Input
              id="upi-id"
              ref={upiIdRef}
              value={values.upiId}
              readOnly={!canManage}
              autoComplete="off"
              placeholder="name@bank"
              aria-invalid={shownUpiIdError ? true : undefined}
              aria-describedby={shownUpiIdError ? 'upi-id-hint upi-id-error' : 'upi-id-hint'}
              onChange={(e) => edit({ upiId: e.target.value })}
            />
            <p id="upi-id-hint" className="text-sm text-muted-foreground">
              Kept when UPI is turned off, so you don&apos;t have to enter it again.
            </p>
            {shownUpiIdError && (
              <p id="upi-id-error" className="text-sm text-red-600">
                {shownUpiIdError}
              </p>
            )}
          </div>

          <div className="flex items-start gap-3">
            <input
              id="upi-reference-required"
              type="checkbox"
              className={checkboxClass}
              checked={values.upiReferenceRequired}
              disabled={!canManage}
              aria-describedby="upi-reference-required-hint"
              onChange={(e) => edit({ upiReferenceRequired: e.target.checked })}
            />
            <div className="flex flex-col gap-1">
              <Label htmlFor="upi-reference-required">Require UTR reference for UPI payments</Label>
              <p id="upi-reference-required-hint" className="text-sm text-muted-foreground">
                Staff must enter the 12-digit UTR when recording a UPI payment.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {formError && (
        <p id="form-error" role="alert" className="text-sm text-red-600">
          {formError}
        </p>
      )}
      {saved && (
        <p role="status" className="text-sm text-emerald-700">
          Payment settings saved.
        </p>
      )}

      {canManage && (
        <div>
          <Button type="submit" disabled={!hasChanges || update.isPending}>
            {update.isPending ? 'Saving…' : 'Save changes'}
          </Button>
        </div>
      )}
    </form>
  );
}

/**
 * Drops draft entries that equal what the server currently holds, so a field the user
 * toggled and toggled back is not "ours" and never overwrites a later change by someone else.
 */
function withoutServerValues(draft: Draft, server: OrganizationPaymentSettings): Draft {
  const kept: Draft = { ...draft };
  if (kept.cashEnabled === server.cashEnabled) delete kept.cashEnabled;
  if (kept.upiEnabled === server.upiEnabled) delete kept.upiEnabled;
  if (kept.upiId === (server.upiId ?? '')) delete kept.upiId;
  if (kept.upiReferenceRequired === server.upiReferenceRequired) delete kept.upiReferenceRequired;
  return kept;
}

function diff(
  server: OrganizationPaymentSettings,
  values: OrganizationPaymentSettings & { upiId: string },
): PatchOrganizationPaymentSettingsRequest {
  const changes: PatchOrganizationPaymentSettingsRequest = {};
  if (values.cashEnabled !== server.cashEnabled) changes.cashEnabled = values.cashEnabled;
  if (values.upiEnabled !== server.upiEnabled) changes.upiEnabled = values.upiEnabled;
  const upiId = values.upiId.trim() || null;
  if (upiId !== server.upiId) changes.upiId = upiId;
  if (values.upiReferenceRequired !== server.upiReferenceRequired) {
    changes.upiReferenceRequired = values.upiReferenceRequired;
  }
  return changes;
}

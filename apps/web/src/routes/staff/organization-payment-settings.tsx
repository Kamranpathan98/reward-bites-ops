import { useState, useEffect } from 'react';
import type { OrganizationPaymentSettings, PatchOrganizationPaymentSettingsRequest } from '@rewardbite/contracts';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Can } from '@/features/auth/can';
import { apiFetch, ApiError } from '@/lib/api-client';

/**
 * Organization Payment Settings page.
 *
 * Owner: full read/write
 * Manager: read-only
 * Cashier/Kitchen: no access
 */
export function OrganizationPaymentSettingsPage(): JSX.Element {
  const [settings, setSettings] = useState<OrganizationPaymentSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Form state
  const [cashEnabled, setCashEnabled] = useState(true);
  const [upiEnabled, setUpiEnabled] = useState(false);
  const [upiId, setUpiId] = useState('');
  const [upiReferenceRequired, setUpiReferenceRequired] = useState(true);

  // Load settings
  useEffect(() => {
    const fetchSettings = async () => {
      try {
        const response = await apiFetch<{ data: OrganizationPaymentSettings }>(
          '/organization/settings',
        );
        setSettings(response.data);
        setCashEnabled(response.data.cashEnabled);
        setUpiEnabled(response.data.upiEnabled);
        setUpiId(response.data.upiId || '');
        setUpiReferenceRequired(response.data.upiReferenceRequired);
        setLoading(false);
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'Failed to load settings');
        setLoading(false);
      }
    };

    fetchSettings();
  }, []);

  const handleSave = async () => {
    setError(null);
    setSuccess(null);

    // Client-side validation
    if (!cashEnabled && !upiEnabled) {
      setError('At least one payment method must be enabled.');
      return;
    }

    if (upiEnabled && !upiId.trim()) {
      setError('UPI ID is required when UPI is enabled.');
      return;
    }

    if (upiId.length > 100) {
      setError('UPI ID must be 100 characters or less.');
      return;
    }

    setSaving(true);
    try {
      const patch: PatchOrganizationPaymentSettingsRequest = {
        cashEnabled,
        upiEnabled,
        upiId: upiId.trim() || null,
        upiReferenceRequired,
      };

      const response = await apiFetch<{ data: OrganizationPaymentSettings }>(
        '/organization/settings',
        { method: 'PATCH', body: patch },
      );

      setSettings(response.data);
      setSuccess('Settings saved successfully.');
      setTimeout(() => setSuccess(null), 5000);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to save settings';
      setError(message);
    } finally {
      setSaving(false);
    }
  };

  const isReadOnly = !true; // TODO: check user role for owner-only

  if (loading) {
    return <p className="text-muted-foreground">Loading settings…</p>;
  }

  if (!settings) {
    return (
      <div className="flex flex-col gap-2">
        <p className="text-red-600">Could not load settings.</p>
        <Button size="sm" variant="outline" onClick={() => window.location.reload()}>
          Retry
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold">Organization Settings</h1>
        <p className="text-sm text-muted-foreground">Payment configuration</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Payment Methods</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          <div>
            <div className="flex items-center justify-between py-2">
              <Label htmlFor="cash-toggle" className="flex flex-col gap-1">
                <span>Cash Payments</span>
                <span className="font-normal text-muted-foreground">
                  Accept cash payments at the counter
                </span>
              </Label>
              <Can permission="settings.payments.manage">
                <input
                  id="cash-toggle"
                  type="checkbox"
                  checked={cashEnabled}
                  onChange={(e) => setCashEnabled(e.target.checked)}
                  disabled={isReadOnly}
                  className="h-5 w-5"
                />
              </Can>
              {!isReadOnly && <span className="h-5 w-5">{cashEnabled ? '✓' : '✗'}</span>}
            </div>
          </div>

          <div className="border-t border-border pt-4">
            <div className="flex items-center justify-between py-2">
              <Label htmlFor="upi-toggle" className="flex flex-col gap-1">
                <span>UPI Payments</span>
                <span className="font-normal text-muted-foreground">
                  Accept payments via UPI
                </span>
              </Label>
              <Can permission="settings.payments.manage">
                <input
                  id="upi-toggle"
                  type="checkbox"
                  checked={upiEnabled}
                  onChange={(e) => setUpiEnabled(e.target.checked)}
                  disabled={isReadOnly}
                  className="h-5 w-5"
                />
              </Can>
              {!isReadOnly && <span className="h-5 w-5">{upiEnabled ? '✓' : '✗'}</span>}
            </div>
          </div>

          {upiEnabled && (
            <>
              <div className="flex flex-col gap-2">
                <Label htmlFor="upi-id">UPI ID (e.g., restaurant@hdfc)</Label>
                <Can permission="settings.payments.manage">
                  <Input
                    id="upi-id"
                    value={upiId}
                    onChange={(e) => setUpiId(e.target.value)}
                    placeholder="Enter your UPI ID"
                    disabled={isReadOnly}
                  />
                </Can>
                {isReadOnly && <p className="text-sm text-muted-foreground">{upiId || '—'}</p>}
              </div>

              <div className="flex items-center justify-between border-t border-border pt-4 py-2">
                <Label htmlFor="upi-ref-toggle" className="flex flex-col gap-1">
                  <span>Require UTR / Reference</span>
                  <span className="font-normal text-muted-foreground">
                    Ask for Unique Transaction Reference on UPI payments
                  </span>
                </Label>
                <Can permission="settings.payments.manage">
                  <input
                    id="upi-ref-toggle"
                    type="checkbox"
                    checked={upiReferenceRequired}
                    onChange={(e) => setUpiReferenceRequired(e.target.checked)}
                    disabled={isReadOnly}
                    className="h-5 w-5"
                  />
                </Can>
                {!isReadOnly && (
                  <span className="h-5 w-5">{upiReferenceRequired ? '✓' : '✗'}</span>
                )}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      {success && <p role="status" className="text-sm text-green-600">{success}</p>}

      <Can permission="settings.payments.manage">
        <Button onClick={handleSave} disabled={saving || isReadOnly}>
          {saving ? 'Saving…' : 'Save changes'}
        </Button>
      </Can>

      {isReadOnly && (
        <p className="text-sm text-muted-foreground">
          Contact the owner to change payment settings.
        </p>
      )}
    </div>
  );
}

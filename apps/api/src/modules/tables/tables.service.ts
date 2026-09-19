import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import * as QRCode from 'qrcode';
import PDFDocument from 'pdfkit';
import type {
  CreateTableRequest,
  LiveTableItem,
  PatchTableRequest,
  TableSummary,
} from '@rewardbite/contracts';
import { ConfigService } from '../../common/config/config.service';
import { DB_POOL, withTenantTx, type Pool } from '../../common/db';
import { generateOpaqueToken } from '../../common/security/opaque-token';
import { recordAuditEvent } from '../audit/audit-writer';
import { RestaurantTableRepository } from './restaurant-table.repository';
import { TableQrTokenRepository } from './table-qr-token.repository';
import { TableSessionRepository } from './table-session.repository';
import type { ActingUser } from './tables.types';

@Injectable()
export class TablesService {
  constructor(
    @Inject(DB_POOL) private readonly pool: Pool,
    private readonly tableRepository: RestaurantTableRepository,
    private readonly qrTokenRepository: TableQrTokenRepository,
    private readonly sessionRepository: TableSessionRepository,
    private readonly config: ConfigService,
  ) {}

  async list(tenantId: string): Promise<TableSummary[]> {
    return withTenantTx(this.pool, { tenantId, actorKind: 'staff' }, async (tx) => {
      const tables = await this.tableRepository.listForTenant(tx, tenantId);
      const activeQr = await this.qrTokenRepository.listActiveForTables(
        tx,
        tenantId,
        tables.map((t) => t.id),
      );
      return tables.map((table) => ({
        id: table.id,
        name: table.name,
        displayOrder: table.displayOrder,
        capacity: table.capacity,
        isActive: table.isActive,
        hasActiveQr: activeQr.has(table.id),
      }));
    });
  }

  async create(actor: ActingUser, input: CreateTableRequest): Promise<{ id: string }> {
    return withTenantTx(
      this.pool,
      { tenantId: actor.tenantId, userId: actor.userId, actorKind: actor.actorKind },
      async (tx) => {
        const existing = await this.tableRepository.findActiveByName(
          tx,
          actor.tenantId,
          input.name,
        );
        if (existing) throw new ConflictException('A table with this name already exists.');

        const table = await this.tableRepository.create(tx, {
          tenantId: actor.tenantId,
          name: input.name,
          displayOrder: input.displayOrder ?? 0,
          capacity: input.capacity ?? null,
        });

        await recordAuditEvent(tx, {
          entityType: 'restaurant_table',
          entityId: table.id,
          action: 'created',
          actorKind: actor.actorKind,
          actorId: actor.userId,
          after: { name: input.name },
        });

        return table;
      },
    );
  }

  async patch(actor: ActingUser, id: string, input: PatchTableRequest): Promise<void> {
    await withTenantTx(
      this.pool,
      { tenantId: actor.tenantId, userId: actor.userId, actorKind: actor.actorKind },
      async (tx) => {
        const table = await this.tableRepository.findById(tx, actor.tenantId, id);
        if (!table || table.deletedAt) throw new NotFoundException('Table not found.');

        if (input.name !== undefined && input.name !== table.name) {
          const existing = await this.tableRepository.findActiveByName(
            tx,
            actor.tenantId,
            input.name,
          );
          if (existing) throw new ConflictException('A table with this name already exists.');
        }

        await this.tableRepository.update(tx, actor.tenantId, id, input);

        await recordAuditEvent(tx, {
          entityType: 'restaurant_table',
          entityId: id,
          action: 'updated',
          actorKind: actor.actorKind,
          actorId: actor.userId,
          before: {
            name: table.name,
            displayOrder: table.displayOrder,
            capacity: table.capacity,
            isActive: table.isActive,
          },
          after: input,
        });
      },
    );
  }

  async softDelete(actor: ActingUser, id: string): Promise<void> {
    await withTenantTx(
      this.pool,
      { tenantId: actor.tenantId, userId: actor.userId, actorKind: actor.actorKind },
      async (tx) => {
        const table = await this.tableRepository.findById(tx, actor.tenantId, id);
        if (!table || table.deletedAt) throw new NotFoundException('Table not found.');

        const openSession = await this.sessionRepository.findOpenForTable(tx, actor.tenantId, id);
        if (openSession) {
          throw new ConflictException('This table has an open session and cannot be deleted.');
        }

        await this.tableRepository.softDelete(tx, actor.tenantId, id);

        await recordAuditEvent(tx, {
          entityType: 'restaurant_table',
          entityId: id,
          action: 'deleted',
          actorKind: actor.actorKind,
          actorId: actor.userId,
        });
      },
    );
  }

  async regenerateQr(actor: ActingUser, id: string): Promise<{ token: string; qrSvgUrl: string }> {
    const token = await withTenantTx(
      this.pool,
      { tenantId: actor.tenantId, userId: actor.userId, actorKind: actor.actorKind },
      async (tx) => {
        const table = await this.tableRepository.findById(tx, actor.tenantId, id);
        if (!table || table.deletedAt) throw new NotFoundException('Table not found.');

        // LOCK old ACTIVE token (if any) FOR UPDATE, then revoke + insert
        // new, matching the architecture's transaction sketch exactly
        // (blueprint section 11, "Regenerate QR"). The partial unique index
        // `table_qr_token_tenant_table_active_unique` is the actual
        // arbiter if two regenerate calls somehow overlap.
        const oldToken = await this.qrTokenRepository.lockActiveForTable(tx, actor.tenantId, id);
        if (oldToken) {
          await this.qrTokenRepository.revoke(tx, actor.tenantId, oldToken.id, actor.userId);
        }

        const newToken = generateOpaqueToken();
        await this.qrTokenRepository.create(tx, {
          tenantId: actor.tenantId,
          tableId: id,
          token: newToken,
        });

        await recordAuditEvent(tx, {
          entityType: 'table_qr_token',
          entityId: id,
          action: 'qr.regenerated',
          actorKind: actor.actorKind,
          actorId: actor.userId,
        });

        return newToken;
      },
    );

    return { token, qrSvgUrl: `/api/v1/tables/${id}/qr.svg` };
  }

  /** Renders the table's current ACTIVE QR token as an SVG string. */
  async renderQrSvg(actor: ActingUser, id: string): Promise<string> {
    const token = await withTenantTx(
      this.pool,
      { tenantId: actor.tenantId, userId: actor.userId, actorKind: actor.actorKind },
      async (tx) => {
        const table = await this.tableRepository.findById(tx, actor.tenantId, id);
        if (!table || table.deletedAt) throw new NotFoundException('Table not found.');

        const qr = await this.qrTokenRepository.findActiveForTable(tx, actor.tenantId, id);
        if (!qr) throw new NotFoundException('This table has no active QR token yet.');
        return qr.token;
      },
    );

    return QRCode.toString(this.qrTargetUrl(token), { type: 'svg', margin: 1 });
  }

  /** Renders one printable PDF sheet containing every active table's QR code. */
  async renderQrSheetPdf(tenantId: string): Promise<Buffer> {
    const tables = await withTenantTx(this.pool, { tenantId, actorKind: 'staff' }, async (tx) => {
      const allTables = await this.tableRepository.listForTenant(tx, tenantId);
      const activeQr = await this.qrTokenRepository.listActiveForTables(
        tx,
        tenantId,
        allTables.map((t) => t.id),
      );
      const withTokens: { name: string; token: string }[] = [];
      for (const table of allTables) {
        if (!activeQr.has(table.id)) continue;
        const qr = await this.qrTokenRepository.findActiveForTable(tx, tenantId, table.id);
        if (qr) withTokens.push({ name: table.name, token: qr.token });
      }
      return withTokens;
    });

    const doc = new PDFDocument({ size: 'A4', margin: 36 });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    const done = new Promise<Buffer>((resolve) => {
      doc.on('end', () => resolve(Buffer.concat(chunks)));
    });

    const columns = 3;
    const cellWidth = 170;
    const cellHeight = 200;
    let column = 0;
    let row = 0;

    for (const table of tables) {
      const png = await QRCode.toBuffer(this.qrTargetUrl(table.token), {
        type: 'png',
        margin: 1,
        width: 140,
      });
      const x = 36 + column * cellWidth;
      const y = 36 + row * cellHeight;
      doc.image(png, x, y, { width: 140, height: 140 });
      doc.fontSize(12).text(table.name, x, y + 145, { width: 140, align: 'center' });

      column += 1;
      if (column >= columns) {
        column = 0;
        row += 1;
      }
    }

    doc.end();
    return done;
  }

  async liveView(tenantId: string): Promise<LiveTableItem[]> {
    return withTenantTx(this.pool, { tenantId, actorKind: 'staff' }, async (tx) => {
      const tables = await this.tableRepository.listForTenant(tx, tenantId);
      const openSessions = await this.sessionRepository.listOpenForTables(
        tx,
        tenantId,
        tables.map((t) => t.id),
      );
      // openOrderCount / unpaidBillTotalPaise: see the LiveTableItem contract note
      // (non-terminal orders; outstanding of FINALIZED bills).
      const counts = await this.sessionRepository.liveCountsForSessions(
        tx,
        tenantId,
        Array.from(openSessions.values()).map((s) => s.id),
      );
      return tables.map((table) => {
        const session = openSessions.get(table.id);
        const live = session ? counts.get(session.id) : undefined;
        return {
          id: table.id,
          name: table.name,
          displayOrder: table.displayOrder,
          capacity: table.capacity,
          isActive: table.isActive,
          openSession: session
            ? {
                id: session.id,
                openedAt: session.openedAt.toISOString(),
                openOrderCount: live?.openOrderCount ?? 0,
                unpaidBillTotalPaise: live?.unpaidBillTotalPaise ?? 0,
              }
            : null,
        };
      });
    });
  }

  private qrTargetUrl(token: string): string {
    const base = this.config.env.APP_BASE_URL ?? 'http://localhost:5173';
    return `${base}/t/${token}`;
  }
}

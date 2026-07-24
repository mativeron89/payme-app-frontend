import { useEffect, useState } from 'react';
import { api, newIdempotencyKey } from '../api';
import { extractApiError } from '../api/errors';
import type { BalanceResponse, Friend } from '../api/types';
import { Avatar, TopBar, useToast } from '../components/ui';
import { goBack, navigate } from '../router';
import { formatMXN } from '../utils/format';
import { stringToCents } from '../utils/money';

/** s-transfer: elegir amigo + monto + concepto → POST /transfers. */
export function TransferScreen({ preselectPaymeId }: { preselectPaymeId?: string }) {
  const toast = useToast();
  const [friends, setFriends] = useState<Friend[]>([]);
  const [balance, setBalance] = useState<BalanceResponse | null>(null);
  const [to, setTo] = useState<Friend | null>(null);
  const [filter, setFilter] = useState('');
  const [amountStr, setAmountStr] = useState('');
  const [concept, setConcept] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api
      .getFriends()
      .then((r) => {
        if (!alive) return;
        setFriends(r.friends);
        // Si venís de tocar ↗️ en la lista de amigos, ya queda elegido.
        if (preselectPaymeId) {
          const match = r.friends.find((f) => f.payme_id === preselectPaymeId);
          if (match) setTo(match);
        }
      })
      .catch(() => undefined);
    api.getBalance().then((b) => alive && setBalance(b)).catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [preselectPaymeId]);

  let amountCents = 0;
  try {
    amountCents = stringToCents(amountStr || '0');
  } catch {
    amountCents = 0;
  }

  const visible = filter
    ? friends.filter(
        (f) =>
          f.full_name.toLowerCase().includes(filter.toLowerCase()) ||
          f.payme_id.toLowerCase().includes(filter.toLowerCase()) ||
          f.email.toLowerCase().includes(filter.toLowerCase()),
      )
    : friends;

  async function doTransfer() {
    if (!to || amountCents <= 0) return;
    setBusy(true);
    setError(null);
    try {
      await api.createTransfer({
        amount_cents: amountCents,
        to_payme_id: to.payme_id,
        ...(concept && { concept }),
        idempotency_key: newIdempotencyKey(),
      });
      toast(`Le enviaste ${formatMXN(amountCents)} a ${to.first_name} ✓`);
      navigate('cuenta');
    } catch (err) {
      const { code, extra } = extractApiError(err);
      if (code === 'insufficient_funds') {
        const available = typeof extra.available === 'number' ? extra.available : 0;
        setError(`Saldo insuficiente: tenés ${formatMXN(available)} disponibles.`);
      } else {
        setError('No pudimos enviar la transferencia. Probá de nuevo.');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="screen">
      <TopBar title="Transferir" onBack={() => goBack('cuenta')} />
      <div className="scroll" style={{ padding: 16 }}>
        <div className="sectlabel">Para</div>
        {!to && (
          <>
            <input
              className="input"
              placeholder="Buscá por nombre, email o ID PayMe"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
            <div className="card" style={{ marginBottom: 12 }}>
              {visible.length === 0 && (
                <div className="empty" style={{ padding: 20 }}>
                  {friends.length === 0 ? 'Todavía no tenés amigos — agregá desde Amigos.' : 'Sin resultados.'}
                </div>
              )}
              {visible.map((f) => (
                <button key={f.id} className="friend-row" onClick={() => setTo(f)}>
                  <Avatar name={f.full_name} />
                  <div className="fr-name">
                    <div className="n">{f.full_name}</div>
                    <div className="id">{f.payme_id}</div>
                  </div>
                </button>
              ))}
            </div>
          </>
        )}
        {to && (
          <button className="friend-row sel" style={{ borderRadius: 10, marginBottom: 12 }} onClick={() => setTo(null)}>
            <Avatar name={to.full_name} />
            <div className="fr-name">
              <div className="n">{to.full_name}</div>
              <div className="id">{to.payme_id}</div>
            </div>
            <span className="badge badge-teal">cambiar</span>
          </button>
        )}

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '14px 0 0' }}>
          <span className="amt-display" style={{ marginRight: 2 }}>
            $
          </span>
          <input
            className="amt-input"
            style={{ width: `${Math.max(2, amountStr.length || 1)}ch` }}
            inputMode="decimal"
            placeholder="0"
            value={amountStr}
            onChange={(e) => setAmountStr(e.target.value.replace(/[^0-9.]/g, ''))}
            aria-label="Monto a transferir"
          />
        </div>
        <div className="caption" style={{ textAlign: 'center', margin: '4px 0 12px' }}>
          {balance ? `Disponible: ${formatMXN(balance.available_cents)}` : ' '}
        </div>
        <input className="input" placeholder="Concepto (opcional)" value={concept} onChange={(e) => setConcept(e.target.value)} maxLength={200} />
        {error && (
          <div className="form-error" role="alert">
            {error}
          </div>
        )}
        <div className="note note-teal">
          Va directo del saldo PayMe al saldo de tu amigo. Inmediata y sin costo.
        </div>
      </div>
      <div className="action-bar">
        <button className="btn btn-primary" onClick={doTransfer} disabled={busy || !to || amountCents <= 0}>
          {busy
            ? 'Enviando…'
            : to && amountCents > 0
              ? `Enviar ${formatMXN(amountCents)} a ${to.first_name}`
              : 'Elegí amigo y monto'}
        </button>
      </div>
    </div>
  );
}

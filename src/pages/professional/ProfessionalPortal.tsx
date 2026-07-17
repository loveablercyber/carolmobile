import { FormEvent, useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { CalendarDays, Camera, CircleDollarSign, Clock3, FileText, Plus, Save, Star, Target, Users, WalletCards, Pencil, X } from 'lucide-react'
import { Avatar, Badge, EmptyState, LoadingState, Modal, PageHeader, SectionHeading, StatCard, Toast } from '../../components/ui'
import { apiFetch, uploadImage } from '../../lib/api'
import { useAuth } from '../../context/AuthContext'

type Result<T>={data:T}
const brl=(v:unknown)=>Number(v||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'})
const dt=(v:unknown)=>v?new Date(String(v)).toLocaleString('pt-BR',{dateStyle:'short',timeStyle:'short'}):'—'
const label:Record<string,string>={requested:'Solicitado',awaiting_payment:'Aguardando pagamento',confirmed:'Confirmado',pending_deposit:'Aguardando sinal',reschedule_requested:'Reagendamento solicitado',in_service:'Em atendimento',completed:'Finalizado',cancelled:'Cancelado',no_show:'Faltou',rescheduled:'Reagendado',pending:'Pendente',approved:'Aprovada',paid:'Paga'}
const tone=(s:string):'green'|'amber'|'rose'|'gold'|'neutral'=>['confirmed','completed','paid','approved'].includes(s)?'green':['pending_deposit','pending'].includes(s)?'amber':['cancelled','no_show'].includes(s)?'rose':'gold'
function useLoad<T>(url:string){const[data,setData]=useState<T|null>(null);const[loading,setLoading]=useState(true);const[error,setError]=useState('');const reload=()=>{setLoading(true);return apiFetch<Result<T>>(url).then(r=>{setData(r.data);setError('')}).catch(e=>{console.error('Professional portal load error',e);setError(e.message)}).finally(()=>setLoading(false))};useEffect(()=>{reload()},[url]);return{data,loading,error,reload}}

export function ProfessionalDashboardPage(){const p=useLoad<any>('/api/portal?resource=professional-dashboard');if(p.loading)return <LoadingState/>;if(!p.data)return <EmptyState title="Não foi possível carregar" text={p.error}/>;const m=p.data.metrics;const goal=Number(p.data.goal?.revenue_goal||0);const progress=goal?Math.min(100,Math.round(Number(m.revenue_month)/goal*100)):0;return <div><PageHeader eyebrow="MINHA OPERAÇÃO" title="Dashboard profissional" subtitle="Somente seus atendimentos, resultados e avaliações."/><div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"><StatCard label="Atendimentos hoje" value={String(m.today)} icon={<CalendarDays/>}/><StatCard label="Faturamento estimado" value={brl(m.revenue_month)} icon={<CircleDollarSign/>}/><StatCard label="Comissão estimada" value={brl(m.commission_month)} icon={<WalletCards/>} tone="dark"/><StatCard label="Meta mensal" value={`${progress}%`} trend={goal?`${brl(m.revenue_month)} de ${brl(goal)}`:'Nenhuma meta configurada'} icon={<Target/>}/></div><div className="mt-6 grid gap-5 lg:grid-cols-[1.3fr_.7fr]"><section className="surface p-6"><SectionHeading title="Próximos atendimentos"/>{p.data.appointments.length?p.data.appointments.map((a:any)=><div key={a.id} className="flex items-center gap-3 border-b border-black/5 py-4"><Avatar src={a.avatar_url} name={a.client}/><span className="flex-1"><b className="block text-xs">{a.client}</b><span className="text-[10px] text-stone-400">{dt(a.starts_at)} • {a.service}</span></span><Badge tone={tone(a.status)}>{label[a.status]||a.status}</Badge></div>):<EmptyState title="Nenhum atendimento próximo" text="Sua agenda dos próximos sete dias está livre."/>}</section><aside className="surface p-6"><SectionHeading title="Seu desempenho"/><div className="grid grid-cols-2 text-center"><div><Star className="mx-auto text-champagne"/><b className="mt-2 block font-display text-3xl">{p.data.reviews.rating}</b><span className="text-[9px] text-stone-400">{p.data.reviews.count} avaliações</span></div><div><Users className="mx-auto text-champagne"/><b className="mt-2 block font-display text-3xl">{m.clients_served}</b><span className="text-[9px] text-stone-400">clientes atendidas</span></div></div></aside></div></div>}

export function ProfessionalCommissionsPage(){const p=useLoad<any[]>('/api/portal?resource=professional-commissions');if(p.loading)return <LoadingState/>;const list=p.data||[];const estimated=list.filter(x=>['pending','approved'].includes(x.status)).reduce((s,x)=>s+Number(x.amount||0),0);const paid=list.filter(x=>x.status==='paid').reduce((s,x)=>s+Number(x.amount||0),0);return <div><PageHeader eyebrow="RESULTADOS" title="Comissões" subtitle="Valores vinculados somente aos seus atendimentos."/><div className="grid gap-4 sm:grid-cols-2"><StatCard label="A receber" value={brl(estimated)} icon={<WalletCards/>}/><StatCard label="Total pago" value={brl(paid)} icon={<CircleDollarSign/>} tone="dark"/></div><section className="surface mt-5 overflow-hidden">{list.length?list.map(x=><div key={x.id} className="grid grid-cols-[1fr_auto] gap-3 border-b border-black/5 p-5 sm:grid-cols-[1.2fr_.7fr_.5fr_auto]"><span><b className="block text-xs">{x.service||'Comissão'}</b><span className="text-[10px] text-stone-400">{x.client||'—'} • {dt(x.starts_at)}</span></span><span className="hidden text-xs sm:block">{x.rate}% de {brl(x.base_amount)}</span><b className="text-xs">{brl(x.amount)}</b><Badge tone={tone(x.status)}>{label[x.status]||x.status}</Badge></div>):<EmptyState title="Nenhuma comissão" text="Comissões geradas por atendimentos aparecerão aqui."/>}</section></div>}

export function ProfessionalServicesPage(){const p=useLoad<any[]>('/api/portal?resource=professional-services');if(p.loading)return <LoadingState/>;return <div><PageHeader eyebrow="PORTFÓLIO" title="Meus serviços" subtitle="Somente serviços atribuídos ao seu perfil."/><div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{p.data?.length?p.data.map(x=><div key={x.id} className="surface p-6"><Badge tone={x.active?'green':'neutral'}>{x.active?'ATIVO':'INATIVO'}</Badge><h2 className="mt-3 font-display text-3xl">{x.name}</h2><p className="muted mt-2">{x.description}</p><div className="mt-5 grid grid-cols-3 rounded-2xl bg-warm p-4 text-center text-xs"><span><b className="block">{x.duration_minutes}min</b><small>Duração</small></span><span><b className="block">{brl(x.price)}</b><small>Preço</small></span><span><b className="block">{x.commission_rate}%</b><small>Comissão</small></span></div></div>):<EmptyState title="Nenhum serviço atribuído" text="Solicite ao administrador a configuração do seu portfólio."/>}</div></div>}

type ProfessionalRecordsPayload={records:any[];appointments:any[];methods:any[];inventory:any[];products:any[]}
interface ProductConsumption {
  productId: string;
  quantity: number;
}
interface TechnicalRecordForm {
  appointmentId: string;
  hairMethodId: string;
  strandsCount: string;
  weightGrams: string;
  color: string;
  shade: string;
  lengthCm: string;
  texture: string;
  hairLot: string;
  productsUsed: string;
  recommendations: string;
  internalNotes: string;
  nextMaintenanceDate: string;
  finalValue: string;
  paymentStatus: string;
  hairInventoryId: string;
  hairInventoryQty: string;
  productConsumptions: ProductConsumption[];
}
const emptyTechnicalRecord=(appointmentId=''):TechnicalRecordForm=>({appointmentId,hairMethodId:'',strandsCount:'',weightGrams:'',color:'',shade:'',lengthCm:'',texture:'',hairLot:'',productsUsed:'',recommendations:'',internalNotes:'',nextMaintenanceDate:'',finalValue:'',paymentStatus:'pending',hairInventoryId:'',hairInventoryQty:'1',productConsumptions:[]})
const technicalRecordForm=(record:any):TechnicalRecordForm=>{
  const pUsed = record.products_used;
  let consumptions: ProductConsumption[] = [];
  let productsStr = '';

  if (Array.isArray(pUsed)) {
    if (pUsed.length > 0 && typeof pUsed[0] === 'string') {
      productsStr = pUsed.join(', ');
    } else {
      consumptions = pUsed.map((p: any) => ({
        productId: p.productId,
        quantity: Number(p.quantity || 1)
      }));
      productsStr = pUsed.map((p: any) => `${p.name} (${p.quantity}x)`).join(', ');
    }
  }

  return {
    appointmentId:record.appointment_id||'',
    hairMethodId:record.hair_method_id||'',
    strandsCount:record.strands_count?.toString()||'',
    weightGrams:record.weight_grams?.toString()||'',
    color:record.color||'',
    shade:record.shade||'',
    lengthCm:record.length_cm?.toString()||'',
    texture:record.texture||'',
    hairLot:record.hair_lot||'',
    productsUsed:productsStr,
    recommendations:record.recommendations||'',
    internalNotes:record.internal_notes||'',
    nextMaintenanceDate:record.next_maintenance_date?.slice(0,10)||'',
    finalValue:record.final_value?.toString()||'',
    paymentStatus:record.payment_status||'pending',
    hairInventoryId:record.hair_inventory_id||'',
    hairInventoryQty:record.hair_inventory_qty?.toString()||'1',
    productConsumptions:consumptions
  };
}

export function ProfessionalRecordsPage(){
  const p=useLoad<ProfessionalRecordsPayload>('/api/portal?resource=professional-records')
  const[form,setForm]=useState<TechnicalRecordForm|null>(null)
  const[files,setFiles]=useState<Record<string,File>>({})
  const[saving,setSaving]=useState(false)
  const[toast,setToast]=useState('')
  const[existingPhotos,setExistingPhotos]=useState<any[]>([])
  const[deletedPhotoIds,setDeletedPhotoIds]=useState<string[]>([])
  if(p.loading)return <LoadingState/>
  const data = p.data
  if(!data)return <EmptyState title="Não foi possível carregar" text={p.error||'Tente novamente em alguns instantes.'}/>
  const records=data.records||[]
  const appointments=data.appointments||[]
  const availableAppointments=appointments.filter(x=>!x.record_id)
  const selectedAppointment=appointments.find(x=>x.id===form?.appointmentId)
  const openNew=()=>{const first=availableAppointments[0];if(!first)return;setFiles({});setExistingPhotos([]);setDeletedPhotoIds([]);setForm({...emptyTechnicalRecord(first.id),hairMethodId:first.hair_method_id||''})}
  const openRecord=(record:any)=>{setFiles({});setExistingPhotos(record.photos || []);setDeletedPhotoIds([]);setForm(technicalRecordForm(record))}
  const close=()=>{if(!saving){setForm(null);setFiles({});setExistingPhotos([]);setDeletedPhotoIds([])}}
  const selectPhoto=(kind:string,file?:File)=>{if(!file)return;if(!file.type.startsWith('image/')||file.size>10*1024*1024){setToast('Selecione uma imagem de até 10 MB.');setTimeout(()=>setToast(''),2600);return}setFiles(current=>({...current,[kind]:file}))}
  const save=async(e:FormEvent)=>{
    e.preventDefault()
    if(!form)return
    setSaving(true)
    try{
      const photos=await Promise.all(Object.entries(files).map(async([kind,file])=>{const uploaded=await uploadImage(file,`technical-${kind}`);return{kind,url:uploaded.url}}))
      await apiFetch('/api/data?resource=technical-records',{method:'POST',body:JSON.stringify({...form,productsUsed:form.productsUsed.split(',').map(x=>x.trim()).filter(Boolean),photos,deletedPhotoIds})})
      await p.reload()
      setForm(null)
      setFiles({})
      setExistingPhotos([])
      setDeletedPhotoIds([])
      setToast('Ficha técnica salva com sucesso.')
    }catch(err){console.error('Technical record save error',err);setToast(err instanceof Error?err.message:'Não foi possível salvar a ficha técnica.')}
    finally{setSaving(false);setTimeout(()=>setToast(''),2600)}
  }
  const copySummary = () => {
    if (!form || !selectedAppointment) return;
    const clientName = selectedAppointment.client || 'Cliente';
    const serviceName = selectedAppointment.service || 'Serviço';
    const dateStr = dt(selectedAppointment.starts_at);

    const method = data.methods.find((x: any) => x.id === form.hairMethodId);
    const methodName = method ? method.name : (form.hairMethodId ? 'Método selecionado' : 'Não informado');

    let productsList = 'Nenhum';
    if (form.productConsumptions && form.productConsumptions.length > 0) {
      productsList = form.productConsumptions.map(pc => {
        const prod = data.products?.find((x: any) => x.id === pc.productId);
        return `- ${prod ? prod.name : 'Produto'} (${pc.quantity}x)`;
      }).join('\n');
    }

    let activeHairLot = form.hairLot;
    if (!activeHairLot && form.hairInventoryId && data.inventory) {
      const invItem = data.inventory.find((h: any) => h.id === form.hairInventoryId);
      if (invItem) activeHairLot = invItem.lot || '';
    }

    const formatMaintenanceDate = (dateStr: string) => {
      if (!dateStr) return 'Não agendada';
      const parts = dateStr.split('-');
      if (parts.length === 3) {
        return `${parts[2]}/${parts[1]}/${parts[0]}`;
      }
      return dateStr;
    };

    const summaryText = `💇‍♀️ *Carol Sol - Resumo de Ficha Técnica*

*Cliente:* ${clientName}
*Serviço:* ${serviceName}
*Data:* ${dateStr}

*Detalhes do Cabelo:*
- Método: ${methodName}
- Lote: ${activeHairLot || 'Sem lote'}
- Quantidade: ${form.strandsCount ? `${form.strandsCount} mechas` : 'Não informado'}
- Peso: ${form.weightGrams ? `${form.weightGrams}g` : 'Não informado'}
- Comprimento: ${form.lengthCm ? (String(form.lengthCm).toLowerCase().includes('cm') ? form.lengthCm : `${form.lengthCm}cm`) : 'Não informado'}
- Cor/Tonalidade: ${[form.color, form.shade].filter(Boolean).join(' / ') || 'Não informado'}
- Textura: ${form.texture || 'Não informado'}

*Produtos Utilizados:*
${productsList}

*Recomendações:*
${form.recommendations || 'Sem recomendações específicas.'}

*Próxima Manutenção:* ${formatMaintenanceDate(form.nextMaintenanceDate)}
*Valor Final:* ${form.finalValue ? brl(form.finalValue) : 'Não informado'}`;

    navigator.clipboard.writeText(summaryText)
      .then(() => {
        setToast('Resumo copiado para a área de transferência.');
        setTimeout(() => setToast(''), 2600);
      })
      .catch(() => {
        setToast('Não foi possível copiar o resumo.');
        setTimeout(() => setToast(''), 2600);
      });
  };
  return <div>
    <Toast show={!!toast} message={toast}/>
    <PageHeader eyebrow="HISTÓRICO TÉCNICO" title="Fichas técnicas" subtitle="Registros reais dos atendimentos vinculados ao seu perfil." action={availableAppointments.length?<button onClick={openNew} className="btn-primary"><Plus size={15}/>Nova ficha</button>:undefined}/>
    <section className="surface overflow-hidden">{records.length?records.map(r=><button type="button" key={r.id} onClick={()=>openRecord(r)} className="grid w-full gap-3 border-b border-black/5 p-5 text-left transition hover:bg-warm/60 sm:grid-cols-[1.2fr_.8fr_.8fr_auto]"><span className="flex items-center gap-3"><Avatar src={r.avatar_url} name={r.client}/><span><b className="block text-xs">{r.client}</b><small className="text-stone-400">Ficha {String(r.id).slice(0,8).toUpperCase()}</small></span></span><span className="text-xs"><small className="block text-stone-400">Método</small>{r.method||'Não informado'}</span><span className="text-xs"><small className="block text-stone-400">Aplicação</small>{dt(r.starts_at||r.created_at)}</span><span className="flex items-center gap-2 text-xs font-bold text-champagne"><FileText size={16}/>Abrir ficha</span></button>):<EmptyState title="Nenhuma ficha técnica" text={availableAppointments.length?'Crie a primeira ficha usando um atendimento vinculado.':'Não há atendimentos aptos para preencher uma ficha.'}/>}</section>
    <Modal open={!!form} onClose={close} title="Ficha técnica">
      {form&&<form onSubmit={save} className="space-y-4">
        <label className="block"><span className="mb-2 block text-xs font-bold">Atendimento</span><select disabled={!!records.find(x=>x.appointment_id===form.appointmentId)} className="field disabled:opacity-60" value={form.appointmentId} onChange={e=>{const appt=appointments.find(x=>x.id===e.target.value);setFiles({});setForm({...form,appointmentId:e.target.value,hairMethodId:appt?.hair_method_id||''})}}>{appointments.filter(x=>!x.record_id||x.id===form.appointmentId).map(x=><option key={x.id} value={x.id}>{x.client} • {x.service} • {dt(x.starts_at)}</option>)}</select></label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label><span className="mb-2 block text-xs font-bold">Método</span><select disabled={!!selectedAppointment?.hair_method_id} className="field disabled:opacity-60" value={form.hairMethodId} onChange={e=>setForm({...form,hairMethodId:e.target.value})}><option value="">Não informado</option>{data.methods.map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
          <label className="block">
            <span className="mb-2 block text-xs font-bold">Lote do estoque</span>
            {data.inventory && data.inventory.length > 0 ? (
              <select
                className="field"
                value={form.hairInventoryId}
                onChange={e => {
                  const selectedId = e.target.value;
                  const item = data.inventory.find((h: any) => h.id === selectedId);
                  setForm({
                    ...form,
                    hairInventoryId: selectedId,
                    hairLot: item ? item.lot || '' : '',
                    color: item ? item.color || '' : '',
                    shade: item ? item.shade || '' : '',
                    lengthCm: item ? (item.length_cm?.toString() || '') : '',
                    texture: item ? item.texture || '' : '',
                    weightGrams: item ? (item.weight_grams?.toString() || '') : '',
                  });
                }}
              >
                <option value="">Nenhum (Usar sem lote)</option>
                {data.inventory.map((x: any) => (
                  <option key={x.id} value={x.id}>
                    {x.lot} ({x.category} • {x.color} • {x.length_cm ? (String(x.length_cm).toLowerCase().includes('cm') ? x.length_cm : `${x.length_cm}cm`) : ''} • {x.quantity} un)
                  </option>
                ))}
              </select>
            ) : (
              <div className="rounded-2xl bg-warm p-3 text-xs text-stone-500">
                Nenhum lote disponível no estoque.
              </div>
            )}
          </label>
          {form.hairInventoryId && (
            <TechnicalInput
              label="Qtd do Lote Consumida (unidades)"
              type="number"
              value={form.hairInventoryQty}
              set={v => setForm({ ...form, hairInventoryQty: v })}
            />
          )}
          <TechnicalInput label="Quantidade de mechas" type="number" value={form.strandsCount} set={v=>setForm({...form,strandsCount:v})}/>
          <TechnicalInput disabled={!!form.hairInventoryId} label="Peso (g)" type="number" value={form.weightGrams} set={v=>setForm({...form,weightGrams:v})}/>
          <TechnicalInput disabled={!!form.hairInventoryId} label="Comprimento" type="text" placeholder="ex: 60/65/70cm" value={form.lengthCm} set={v=>setForm({...form,lengthCm:v})}/>
          <TechnicalInput disabled={!!form.hairInventoryId} label="Cor" value={form.color} set={v=>setForm({...form,color:v})}/>
          <TechnicalInput disabled={!!form.hairInventoryId} label="Tonalidade" value={form.shade} set={v=>setForm({...form,shade:v})}/>
          <TechnicalInput disabled={!!form.hairInventoryId} label="Textura" value={form.texture} set={v=>setForm({...form,texture:v})}/>
          <TechnicalInput label="Próxima manutenção" type="date" value={form.nextMaintenanceDate} set={v=>setForm({...form,nextMaintenanceDate:v})}/>
          <TechnicalInput label="Valor final" type="number" value={form.finalValue} set={v=>setForm({...form,finalValue:v})}/>
        </div>
        <div className="surface p-4 space-y-3 rounded-2xl border border-black/5 bg-warm/30">
          <span className="text-xs font-bold block">Produtos do Estoque Consumidos</span>
          {form.productConsumptions.map((pc, idx) => {
            const product = data.products?.find((x: any) => x.id === pc.productId);
            return (
              <div key={idx} className="flex items-center gap-2 text-xs">
                <span className="flex-1 font-medium">
                  {product ? `${product.name} (Saldo: ${product.stock_quantity})` : 'Produto desconhecido'}
                </span>
                <input
                  type="number"
                  min="1"
                  className="field w-20 py-1 px-2"
                  value={pc.quantity}
                  onChange={e => {
                    const newQty = Math.max(1, Number(e.target.value));
                    const updated = [...form.productConsumptions];
                    updated[idx] = { ...pc, quantity: newQty };
                    setForm({ ...form, productConsumptions: updated });
                  }}
                />
                <button
                  type="button"
                  onClick={() => {
                    const updated = form.productConsumptions.filter((_, i) => i !== idx);
                    setForm({ ...form, productConsumptions: updated });
                  }}
                  className="text-rose-500 hover:underline"
                >
                  Remover
                </button>
              </div>
            );
          })}
          <div className="flex gap-2 items-center">
            <select
              id="product-select"
              className="field flex-1"
              defaultValue=""
              onChange={e => {
                const prodId = e.target.value;
                if (!prodId) return;
                if (form.productConsumptions.some(pc => pc.productId === prodId)) {
                  e.target.value = "";
                  return;
                }
                const updated = [...form.productConsumptions, { productId: prodId, quantity: 1 }];
                setForm({ ...form, productConsumptions: updated });
                e.target.value = "";
              }}
            >
              <option value="">+ Selecionar Produto do Estoque...</option>
              {data.products?.map((x: any) => (
                <option key={x.id} value={x.id}>
                  {x.name} ({x.sku} • Saldo: {x.stock_quantity})
                </option>
              ))}
            </select>
          </div>
        </div>
        <label className="block"><span className="mb-2 block text-xs font-bold">Recomendações para a cliente</span><textarea className="field min-h-20 py-3" value={form.recommendations} onChange={e=>setForm({...form,recommendations:e.target.value})}/></label>
        <label className="block"><span className="mb-2 block text-xs font-bold">Observações internas</span><textarea className="field min-h-20 py-3" value={form.internalNotes} onChange={e=>setForm({...form,internalNotes:e.target.value})}/></label>
        {selectedAppointment?.photos_allowed ? (
          <div className="grid grid-cols-3 gap-2">
            {([['before', 'Antes'], ['during', 'Durante'], ['after', 'Depois']] as const).map(([kind, title]) => {
              const existing = existingPhotos.find(ph => ph.kind === kind && !deletedPhotoIds.includes(ph.id));

              if (existing) {
                return (
                  <div key={kind} className="relative min-h-24 rounded-2xl border border-black/5 overflow-hidden bg-stone-100 flex flex-col items-center justify-between p-2">
                    <img src={existing.url} alt={title} className="h-16 w-full object-cover rounded-xl" />
                    <div className="flex gap-2 mt-1">
                      <button
                        type="button"
                        onClick={() => {
                          setDeletedPhotoIds(current => [...current, existing.id]);
                          const input = document.getElementById(`file-input-${kind}`) as HTMLInputElement;
                          input?.click();
                        }}
                        className="text-[9px] font-bold text-champagne hover:underline"
                      >
                        Substituir
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setDeletedPhotoIds(current => [...current, existing.id]);
                        }}
                        className="text-[9px] font-bold text-rose-500 hover:underline"
                      >
                        Excluir
                      </button>
                    </div>
                    <input
                      id={`file-input-${kind}`}
                      disabled={saving}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={e => selectPhoto(kind, e.target.files?.[0])}
                    />
                  </div>
                );
              }

              const chosenFile = files[kind];
              if (chosenFile) {
                return (
                  <div key={kind} className="relative min-h-24 rounded-2xl border border-dashed border-champagne bg-warm/50 flex flex-col items-center justify-center p-2 text-center">
                    <Camera className="text-champagne" size={18} />
                    <b className="mt-1 block text-[9px] truncate max-w-full">{chosenFile.name}</b>
                    <button
                      type="button"
                      onClick={() => {
                        setFiles(current => {
                          const updated = { ...current };
                          delete updated[kind];
                          return updated;
                        });
                      }}
                      className="text-[9px] font-bold text-rose-500 hover:underline mt-1"
                    >
                      Remover
                    </button>
                  </div>
                );
              }

              return (
                <label key={kind} className="grid min-h-24 cursor-pointer place-items-center rounded-2xl border border-dashed border-champagne/50 bg-warm p-3 text-center">
                  <span>
                    <Camera className="mx-auto text-champagne" size={18} />
                    <b className="mt-1 block text-[9px]">{title}</b>
                  </span>
                  <input
                    disabled={saving}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={e => selectPhoto(kind, e.target.files?.[0])}
                  />
                </label>
              );
            })}
          </div>
        ) : (
          <p className="rounded-2xl bg-warm p-4 text-xs text-stone-500">
            Fotos desabilitadas: a cliente ainda não concedeu o consentimento específico.
          </p>
        )}
        {selectedAppointment&&<a href={`/profissional/clientes/${selectedAppointment.client_id}`} className="block text-xs font-bold text-champagne">Abrir histórico da cliente</a>}
        <div className="flex gap-2">
          {records.find(x => x.appointment_id === form.appointmentId) && (
            <button type="button" onClick={copySummary} className="btn-secondary flex-1 py-3 text-xs flex items-center justify-center gap-1">
              <FileText size={15}/>Copiar resumo
            </button>
          )}
          <button disabled={saving} className="btn-primary flex-1"><Save size={15}/>{saving?'Salvando…':'Salvar ficha'}</button>
        </div>
      </form>}
    </Modal>
  </div>
}

function TechnicalInput({label,value,set,type='text',disabled=false,placeholder}:{label:string;value:string;set:(v:string)=>void;type?:string;disabled?:boolean;placeholder?:string}){return <label className="block"><span className="mb-2 block text-xs font-bold">{label}</span><input disabled={disabled} className="field disabled:opacity-60" min={type==='number'?'0':undefined} step={type==='number'?'any':undefined} type={type} placeholder={placeholder} value={value} onChange={e=>set(e.target.value)}/></label>}

export function ProfessionalAvailabilityPage(){
  const p=useLoad<any>('/api/portal?resource=professional-availability');
  const[open,setOpen]=useState(false);
  const[form,setForm]=useState({date:'',start:'09:00',end:'10:00',reason:''});
  const[toast,setToast]=useState('');
  const[saving,setSaving]=useState(false);

  const[journeyModalOpen, setJourneyModalOpen] = useState(false);
  const[journeyForm, setJourneyForm] = useState<Array<{ weekday: number; starts_at: string; ends_at: string; active: boolean }>>([]);

  if(p.loading)return <LoadingState/>;

  const block=async(e:FormEvent)=>{
    e.preventDefault();
    setSaving(true);
    try{
      await apiFetch('/api/portal?resource=blocked-schedule',{method:'POST',body:JSON.stringify({startsAt:`${form.date}T${form.start}:00-03:00`,endsAt:`${form.date}T${form.end}:00-03:00`,reason:form.reason})});
      await p.reload();
      setOpen(false);
      setToast('Horário bloqueado com sucesso.')
    }catch(err){
      console.error('Blocked schedule error',err);
      setToast(err instanceof Error?err.message:'Não foi possível concluir a ação.')
    }finally{
      setSaving(false);
      setTimeout(()=>setToast(''),2200)
    }
  };

  const handleOpenJourney = () => {
    const initial = Array.from({ length: 7 }, (_, i) => {
      const existing = p.data?.availability?.find((x: any) => x.weekday === i);
      return {
        weekday: i,
        starts_at: existing ? existing.starts_at.slice(0, 5) : "09:00",
        ends_at: existing ? existing.ends_at.slice(0, 5) : "18:00",
        active: existing ? Boolean(existing.active) : false,
      };
    });
    setJourneyForm(initial);
    setJourneyModalOpen(true);
  };

  const saveJourney = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const activeSlots = journeyForm.filter(x => x.active);
      await apiFetch("/api/portal?resource=professional-availability", {
        method: "POST",
        body: JSON.stringify({
          availability: activeSlots
        })
      });
      await p.reload();
      setJourneyModalOpen(false);
      setToast("Jornada semanal salva com sucesso.");
    } catch (err) {
      console.error("Save journey error", err);
      setToast(err instanceof Error ? err.message : "Erro ao salvar jornada.");
    } finally {
      setSaving(false);
      setTimeout(() => setToast(""), 2200);
    }
  };

  const days=['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];

  return <div>
    <Toast show={!!toast} message={toast}/>
    <PageHeader
      eyebrow="DISPONIBILIDADE"
      title="Jornada e bloqueios"
      subtitle="Controle seus horários sem alterar a agenda de outras profissionais."
      action={
        <div className="flex gap-2">
          <button onClick={handleOpenJourney} className="btn-secondary">
            <Pencil size={15} />
            Editar Jornada
          </button>
          <button onClick={()=>setOpen(true)} className="btn-primary">
            <Clock3 size={15}/>
            Bloquear período
          </button>
        </div>
      }
    />
    <div className="grid gap-5 lg:grid-cols-2">
      <section className="surface p-6">
        <SectionHeading title="Jornada semanal"/>
        {p.data?.availability?.length?p.data.availability.map((x:any)=>(
          <div key={x.id} className="flex justify-between border-b border-black/5 py-3 text-xs">
            <b>{days[x.weekday]}</b>
            <span>{String(x.starts_at).slice(0,5)}–{String(x.ends_at).slice(0,5)}</span>
          </div>
        )):<EmptyState title="Jornada não configurada" text="Nenhum horário semanal cadastrado."/>}
      </section>
      <section className="surface p-6">
        <SectionHeading title="Próximos bloqueios"/>
        {p.data?.blocked?.length?p.data.blocked.map((x:any)=>(
          <div key={x.id} className="border-b border-black/5 py-3">
            <b className="text-xs">{x.reason||'Bloqueio'}</b>
            <span className="block text-[10px] text-stone-400">{dt(x.starts_at)} até {dt(x.ends_at)}</span>
          </div>
        )):<EmptyState title="Nenhum bloqueio" text="Sua disponibilidade está livre."/>}
      </section>
    </div>

    {/* Modal Editar Jornada Semanal */}
    <Modal open={journeyModalOpen} onClose={() => { if (!saving) setJourneyModalOpen(false); }} title="Editar jornada semanal">
      <form onSubmit={saveJourney} className="space-y-4">
        {journeyForm.map((item, idx) => (
          <div key={item.weekday} className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-black/5 pb-3">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={item.active}
                onChange={e => {
                  const updated = [...journeyForm];
                  updated[idx] = { ...item, active: e.target.checked };
                  setJourneyForm(updated);
                }}
              />
              <span className="text-xs font-bold w-12">{days[item.weekday]}</span>
            </label>

            {item.active && (
              <div className="flex items-center gap-2">
                <input
                  type="time"
                  className="field py-1 px-2 text-xs w-24"
                  value={item.starts_at}
                  onChange={e => {
                    const updated = [...journeyForm];
                    updated[idx] = { ...item, starts_at: e.target.value };
                    setJourneyForm(updated);
                  }}
                />
                <span className="text-stone-400 text-xs">até</span>
                <input
                  type="time"
                  className="field py-1 px-2 text-xs w-24"
                  value={item.ends_at}
                  onChange={e => {
                    const updated = [...journeyForm];
                    updated[idx] = { ...item, ends_at: e.target.value };
                    setJourneyForm(updated);
                  }}
                />
              </div>
            )}
          </div>
        ))}
        <button disabled={saving} className="btn-primary w-full mt-4">
          {saving ? 'Salvando…' : 'Salvar jornada semanal'}
        </button>
      </form>
    </Modal>

    <Modal open={open} onClose={()=>{if(!saving)setOpen(false)}} title="Bloquear período">
      <form onSubmit={block} className="space-y-4">
        <Input label="Data" type="date" value={form.date} set={v=>setForm({...form,date:v})}/>
        <div className="grid grid-cols-2 gap-3">
          <Input label="Início" type="time" value={form.start} set={v=>setForm({...form,start:v})}/>
          <Input label="Fim" type="time" value={form.end} set={v=>setForm({...form,end:v})}/>
        </div>
        <Input label="Motivo" value={form.reason} set={v=>setForm({...form,reason:v})}/>
        <button disabled={saving} className="btn-primary w-full">{saving?'Salvando…':'Salvar bloqueio'}</button>
      </form>
    </Modal>
  </div>
}

export function ProfessionalProfilePage(){const{refresh}=useAuth();const p=useLoad<any>('/api/portal?resource=profile');const[form,setForm]=useState<any>({});const[saving,setSaving]=useState(false);const[toast,setToast]=useState('');useEffect(()=>{if(p.data)setForm({fullName:p.data.full_name,email:p.data.email,phone:p.data.phone||'',birthDate:p.data.birth_date?.slice(0,10)||'',instagram:p.data.instagram||'',address:p.data.address||{},avatarUrl:p.data.avatar_url||'',bio:p.data.bio||'',specialties:p.data.specialties||[]})},[p.data]);if(p.loading)return <LoadingState/>;const save=async(e:FormEvent)=>{e.preventDefault();setSaving(true);try{await apiFetch('/api/portal?resource=profile',{method:'PATCH',body:JSON.stringify(form)});await Promise.all([p.reload(),refresh()]);setToast('Alterações salvas com sucesso.')}catch(err){console.error('Professional profile error',err);setToast(err instanceof Error?err.message:'Ocorreu um erro ao salvar os dados.')}finally{setSaving(false);setTimeout(()=>setToast(''),2200)}};return <div><Toast show={!!toast} message={toast}/><PageHeader eyebrow="PERFIL PROFISSIONAL" title={p.data?.full_name||'Perfil'} subtitle="Dados, biografia e especialidades persistidos no Neon."/><form onSubmit={save} className="grid gap-5 lg:grid-cols-[300px_1fr]"><aside className="surface p-7 text-center"><Avatar src={form.avatarUrl} name={form.fullName||''} size="lg"/><h2 className="mt-4 font-display text-3xl">{form.fullName}</h2><p className="muted mt-2">{p.data?.active?'Profissional ativa':'Profissional inativa'}</p></aside><section className="surface p-6"><div className="grid gap-4 sm:grid-cols-2"><Input label="Nome" value={form.fullName||''} set={v=>setForm({...form,fullName:v})}/><Input label="E-mail" type="email" value={form.email||''} set={v=>setForm({...form,email:v})}/><Input label="Telefone" value={form.phone||''} set={v=>setForm({...form,phone:v})}/><Input label="Instagram" value={form.instagram||''} set={v=>setForm({...form,instagram:v})}/></div><label className="mt-4 block"><span className="mb-2 block text-xs font-bold">Biografia</span><textarea className="field min-h-24 py-3" value={form.bio||''} onChange={e=>setForm({...form,bio:e.target.value})}/></label><label className="mt-4 block"><span className="mb-2 block text-xs font-bold">Especialidades, separadas por vírgula</span><input className="field" value={(form.specialties||[]).join(', ')} onChange={e=>setForm({...form,specialties:e.target.value.split(',').map(x=>x.trim()).filter(Boolean)})}/></label><button disabled={saving} className="btn-primary mt-5"><Save size={15}/>{saving?'Salvando…':'Salvar perfil'}</button></section></form></div>}

export function ProfessionalClientDetailPage(){
  const id=useLocation().pathname.split('/clientes/')[1];
  const p=useLoad<any>(`/api/portal?resource=client-detail&id=${encodeURIComponent(id||'')}`);
  const[note,setNote]=useState('');
  const[toast,setToast]=useState('');
  const[selectedIntake,setSelectedIntake]=useState<any>(null);

  // Edit form states
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editForm, setEditForm] = useState({
    fullName: "",
    email: "",
    phone: "",
    cpf: "",
    instagram: "",
    birthDate: "",
    password: "",
  });

  if(p.loading)return <LoadingState/>;
  if(!p.data)return <EmptyState title="Cliente indisponível" text={p.error||'Esta cliente não está vinculada à sua agenda.'}/>;
  const d=p.data;

  // Edit handler
  const handleOpenEdit = () => {
    setEditForm({
      fullName: d.profile.full_name || "",
      email: d.profile.email || "",
      phone: d.profile.phone || "",
      cpf: d.profile.cpf || "",
      instagram: d.profile.instagram || "",
      birthDate: d.profile.birth_date ? d.profile.birth_date.slice(0, 10) : "",
      password: "",
    });
    setEditModalOpen(true);
  };

  const handleSaveEdit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await apiFetch("/api/portal?resource=admin-client", {
        method: "POST",
        body: JSON.stringify({
          id,
          fullName: editForm.fullName,
          email: editForm.email,
          phone: editForm.phone,
          whatsapp: editForm.phone,
          cpf: editForm.cpf,
          instagram: editForm.instagram,
          birthDate: editForm.birthDate || null,
          password: editForm.password || undefined,
        }),
      });
      await p.reload();
      setEditModalOpen(false);
      setToast("Dados da cliente atualizados.");
    } catch (err) {
      console.error("Edit client error", err);
      setToast(err instanceof Error ? err.message : "Erro ao atualizar dados.");
    } finally {
      setSaving(false);
      setTimeout(() => setToast(""), 2200);
    }
  };

  const add=async()=>{
    try{
      await apiFetch('/api/portal?resource=client-note',{method:'POST',body:JSON.stringify({clientId:id,note})});
      setNote('');
      await p.reload();
      setToast('Observação adicionada.')
    }catch(err){
      console.error('Professional client note error',err);
      setToast(err instanceof Error?err.message:'Não foi possível concluir a ação.')
    }finally{
      setTimeout(()=>setToast(''),2200)
    }
  };

  // Compute values
  const completedAppointments = d.appointments.filter((a: any) => a.status === "completed");
  const cancelledAppointments = d.appointments.filter((a: any) => a.status === "cancelled");
  const lastAppointment = completedAppointments.length > 0 ? completedAppointments[0].starts_at : null;
  const nextAppointmentObj = d.appointments
    .filter((a: any) => ["confirmed", "rescheduled", "pending_deposit"].includes(a.status) && new Date(a.starts_at) >= new Date())
    .sort((a: any, b: any) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime())[0];
  const nextAppointment = nextAppointmentObj ? nextAppointmentObj.starts_at : null;

  return <div>
    <Toast show={!!toast} message={toast}/>

    <div className="mb-4">
      <a href="/profissional/clientes" className="text-xs font-bold text-champagne flex items-center gap-1">
        ← Voltar para Clientes
      </a>
    </div>

    <PageHeader
      eyebrow="CLIENTE VINCULADA"
      title={d.profile.full_name}
      subtitle={`${d.profile.phone||'Sem telefone'} • Histórico e ficha técnica da cliente`}
      action={
        <button onClick={handleOpenEdit} className="btn-primary">
          <Pencil size={15} />
          Editar Cadastro
        </button>
      }
    />

    <div className="grid gap-5 lg:grid-cols-[320px_1fr]">
      {/* Sidebar Column */}
      <aside className="space-y-5">
        <section className="surface p-6 text-center">
          <div className="flex justify-center">
            <Avatar src={d.profile.avatar_url} name={d.profile.full_name} size="lg"/>
          </div>
          <h2 className="mt-4 font-display text-3xl font-bold">{d.profile.full_name}</h2>
          <p className="muted mt-2 text-xs">Preferências: {Object.values(d.profile.preferences||{}).join(' • ')||'Não informadas'}</p>

          <div className="mt-5 text-left text-xs space-y-3 border-t border-black/5 pt-4">
            <div>
              <span className="text-stone-400 block">E-mail</span>
              <span className="font-bold">{d.profile.email || "—"}</span>
            </div>
            <div>
              <span className="text-stone-400 block">Telefone</span>
              <span className="font-bold">{d.profile.phone || "—"}</span>
            </div>
            <div>
              <span className="text-stone-400 block">WhatsApp</span>
              {d.profile.phone ? (
                <a
                  href={`https://wa.me/${d.profile.phone.replace(/\D/g, "")}`}
                  target="_blank"
                  rel="noreferrer"
                  className="font-bold text-champagne hover:underline"
                >
                  Conversar no WhatsApp →
                </a>
              ) : (
                <span className="font-bold">—</span>
              )}
            </div>
            {d.profile.cpf && (
              <div>
                <span className="text-stone-400 block">CPF</span>
                <span className="font-bold">{d.profile.cpf}</span>
              </div>
            )}
            {d.profile.instagram && (
              <div>
                <span className="text-stone-400 block">Instagram</span>
                <a
                  href={`https://instagram.com/${d.profile.instagram}`}
                  target="_blank"
                  rel="noreferrer"
                  className="font-bold text-champagne hover:underline"
                >
                  @{d.profile.instagram}
                </a>
              </div>
            )}
            <div>
              <span className="text-stone-400 block">Data de Cadastro</span>
              <span className="font-bold">{d.profile.created_at ? new Date(d.profile.created_at).toLocaleDateString("pt-BR") : "—"}</span>
            </div>
            <div>
              <span className="text-stone-400 block">Último Atendimento</span>
              <span className="font-bold">{lastAppointment ? dt(lastAppointment) : "Nenhum atendimento finalizado"}</span>
            </div>
            <div>
              <span className="text-stone-400 block">Próximo Agendamento</span>
              <span className="font-bold">{nextAppointment ? dt(nextAppointment) : "Nenhum agendamento futuro"}</span>
            </div>
          </div>
        </section>
      </aside>

      {/* Main Column */}
      <div className="space-y-5">
        {/* Histórico Completo de Agendamentos */}
        <section className="surface p-6">
          <SectionHeading title="Histórico completo de agendamentos" />
          <div className="max-h-[300px] overflow-y-auto space-y-3 pr-1">
            {d.appointments.length ? d.appointments.map((a: any) => (
              <div key={a.id} className="flex justify-between items-center border-b border-black/5 py-3 text-xs">
                <span>
                  <b className="block text-xs">{a.service}</b>
                  <span className="text-[10px] text-stone-400">
                    {dt(a.starts_at)} • {a.professional || "Profissional"} • {brl(a.estimated_value)}
                  </span>
                  {a.intake_data && a.intake_data.answers && (
                    <button
                      type="button"
                      onClick={() => setSelectedIntake(a.intake_data)}
                      className="mt-1 block text-[10px] font-bold text-champagne hover:underline text-left"
                    >
                      [Ver Diagnóstico]
                    </button>
                  )}
                </span>
                <Badge tone={tone(a.status)}>{label[a.status] || a.status}</Badge>
              </div>
            )) : <EmptyState title="Nenhum agendamento" text="Esta cliente não possui agendamentos cadastrados." />}
          </div>
        </section>

        {/* Serviços Realizados & Cancelados */}
        <div className="grid gap-5 md:grid-cols-2">
          <section className="surface p-6">
            <SectionHeading title="Serviços realizados" />
            <div className="max-h-[200px] overflow-y-auto space-y-2 pr-1">
              {completedAppointments.length ? completedAppointments.map((a: any) => (
                <div key={a.id} className="border-b border-black/5 py-2 text-xs">
                  <b className="block">{a.service}</b>
                  <span className="text-[10px] text-stone-400">{dt(a.starts_at)} • {brl(a.estimated_value)}</span>
                </div>
              )) : <p className="text-xs text-stone-400">Nenhum serviço realizado ainda.</p>}
            </div>
          </section>

          <section className="surface p-6">
            <SectionHeading title="Serviços cancelados" />
            <div className="max-h-[200px] overflow-y-auto space-y-2 pr-1">
              {cancelledAppointments.length ? cancelledAppointments.map((a: any) => (
                <div key={a.id} className="border-b border-black/5 py-2 text-xs">
                  <b className="block">{a.service}</b>
                  <span className="text-[10px] text-stone-400">{dt(a.starts_at)}</span>
                </div>
              )) : <p className="text-xs text-stone-400">Nenhum serviço cancelado.</p>}
            </div>
          </section>
        </div>

        {/* Histórico de Pagamentos e Cobranças */}
        <section className="surface p-6">
          <SectionHeading title="Histórico de pagamentos e cobranças" />
          <div className="max-h-[300px] overflow-y-auto space-y-3 pr-1">
            {d.payments && d.payments.length ? d.payments.map((py: any) => (
              <div key={py.id} className="flex justify-between items-center border-b border-black/5 py-3 text-xs">
                <span>
                  <b className="block text-xs">Cobrança - {py.method === "pix_manual" ? "PIX Manual" : py.method.toUpperCase()}</b>
                  <span className="text-[10px] text-stone-400">
                    Criado em: {new Date(py.created_at).toLocaleDateString("pt-BR")}
                    {py.paid_at ? ` • Pago em: ${new Date(py.paid_at).toLocaleDateString("pt-BR")}` : ""}
                  </span>
                </span>
                <div className="text-right">
                  <b className="block text-xs">{brl(py.amount)}</b>
                  <Badge tone={tone(py.status)}>{label[py.status] || py.status}</Badge>
                </div>
              </div>
            )) : <EmptyState title="Nenhum pagamento" text="Não há cobranças ou pagamentos registrados para esta cliente." />}
          </div>
        </section>

        {/* Observações */}
        <section className="surface p-6">
          <SectionHeading title="Observações da cliente" />
          <div className="space-y-3 max-h-[300px] overflow-y-auto pr-1">
            {d.notes.map((n:any)=><div key={n.id} className="border-b border-black/5 py-3"><b className="text-xs">{n.author}</b><p className="text-[11px] text-stone-500 mt-1">{n.note}</p></div>)}
          </div>
          <div className="mt-4 flex gap-2">
            <input className="field" value={note} onChange={e=>setNote(e.target.value)} placeholder="Adicionar observação"/>
            <button disabled={note.trim().length<3} onClick={add} className="btn-primary">Salvar Nota</button>
          </div>
        </section>
      </div>
    </div>

    {/* Modal Editar Cadastro */}
    <Modal open={editModalOpen} onClose={() => { if (!saving) setEditModalOpen(false); }} title="Editar cadastro da cliente">
      <form onSubmit={handleSaveEdit} className="space-y-4">
        <Input label="Nome completo" value={editForm.fullName} set={v => setEditForm({ ...editForm, fullName: v })} />
        <Input label="E-mail" type="email" value={editForm.email} set={v => setEditForm({ ...editForm, email: v })} />
        <Input label="WhatsApp" value={editForm.phone} set={v => setEditForm({ ...editForm, phone: v })} />
        <Input label="CPF" value={editForm.cpf} set={v => setEditForm({ ...editForm, cpf: v })} />
        <Input label="Instagram (sem @)" value={editForm.instagram} set={v => setEditForm({ ...editForm, instagram: v })} />
        <Input label="Data de Nascimento" type="date" value={editForm.birthDate} set={v => setEditForm({ ...editForm, birthDate: v })} />
        <label className="block text-stone-700">
          <span className="mb-2 block text-xs font-bold font-sans">Nova Senha de Acesso (Opcional)</span>
          <input
            className="field bg-white"
            type="password"
            value={editForm.password}
            onChange={(e) => setEditForm({ ...editForm, password: e.target.value })}
            placeholder="Defina a senha ou deixe em branco"
          />
        </label>
        <button disabled={saving} className="btn-primary w-full mt-4">
          {saving ? 'Salvando...' : 'Salvar Alterações'}
        </button>
      </form>
    </Modal>

    <IntakeDetailsModal
      open={!!selectedIntake}
      onClose={() => setSelectedIntake(null)}
      intakeData={selectedIntake}
      clientName={d.profile.full_name}
    />
  </div>
}

function Input({label,value,set,type='text'}:{label:string;value:string;set:(v:string)=>void;type?:string}){return <label className="block"><span className="mb-2 block text-xs font-bold">{label}</span><input className="field" required type={type} value={value} onChange={e=>set(e.target.value)}/></label>}

interface IntakeDetailsModalProps {
  open: boolean;
  onClose: () => void;
  intakeData: any;
  clientName: string;
}

export function IntakeDetailsModal({ open, onClose, intakeData, clientName }: IntakeDetailsModalProps) {
  if (!intakeData || !intakeData.answers) return null;
  const answers = intakeData.answers;
  const fields = [
    ["Objetivo", answers.objective],
    ["Comprimento atual", answers.length],
    ["Cor atual", answers.color],
    ["Química nos fios", answers.chemistry],
    ["Experiência Mega Hair", answers.used],
    ["Orçamento aproximado", answers.budget],
    ["Frequência preferida", answers.frequency],
    ["Método preferido", answers.method],
  ].filter(x => x[1]);

  return (
    <Modal open={open} onClose={onClose} title={`Diagnóstico de ${clientName}`}>
      <div className="space-y-5">
        <div className="grid gap-3 sm:grid-cols-2">
          {fields.map(([label, val]) => (
            <div key={label} className="rounded-2xl bg-warm p-4">
              <span className="text-[10px] font-bold uppercase tracking-wider text-stone-400 block mb-1">
                {label}
              </span>
              <span className="text-xs font-bold block">{val}</span>
            </div>
          ))}
        </div>
        {intakeData.photos && intakeData.photos.filter(Boolean).length > 0 && (
          <div>
            <h4 className="text-xs font-bold uppercase tracking-wider text-stone-400 mb-2">
              Fotos do cabelo enviadas
            </h4>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {intakeData.photos.filter(Boolean).map((url: string, idx: number) => (
                <a
                  key={idx}
                  href={url}
                  target="_blank"
                  rel="noreferrer"
                  className="relative block aspect-[3/4] rounded-[20px] overflow-hidden border border-black/5"
                >
                  <img src={url} alt={`Diagnóstico ${idx + 1}`} className="absolute inset-0 w-full h-full object-cover" />
                </a>
              ))}
            </div>
          </div>
        )}
        <button type="button" onClick={onClose} className="btn-primary w-full mt-4">
          Fechar
        </button>
      </div>
    </Modal>
  );
}

export function ProfessionalAppointmentDetailPage() {
  const id = useLocation().pathname.split("/agenda/")[1];
  const p = useLoad<any>(`/api/data?resource=appointment-detail&id=${encodeURIComponent(id || "")}`);

  const [notes, setNotes] = useState("");
  const [supportText, setSupportText] = useState("");
  const [supportModalOpen, setSupportModalOpen] = useState(false);
  const [toast, setToast] = useState("");
  const [updating, setUpdating] = useState(false);

  useEffect(() => {
    if (p.data?.appointment) {
      setNotes(p.data.appointment.notes || "");
    }
  }, [p.data]);

  if (p.loading) return <LoadingState />;
  if (!p.data?.appointment) return <EmptyState title="Agendamento não encontrado" text={p.error || "Tente novamente mais tarde."} />;

  const a = p.data.appointment;
  const history = p.data.history || [];
  const clientProfile = a.client_profile || {};

  const saveNotes = async () => {
    setUpdating(true);
    try {
      await apiFetch("/api/data?resource=appointments", {
        method: "PATCH",
        body: JSON.stringify({ id, notes })
      });
      await p.reload();
      setToast("Observação rápida salva com sucesso.");
    } catch (err) {
      console.error("Save notes error", err);
      setToast(err instanceof Error ? err.message : "Erro ao salvar observação.");
    } finally {
      setUpdating(false);
      setTimeout(() => setToast(""), 2200);
    }
  };

  const updateStatus = async (status: string) => {
    setUpdating(true);
    try {
      await apiFetch("/api/data?resource=appointments", {
        method: "PATCH",
        body: JSON.stringify({ id, status })
      });
      await p.reload();
      setToast(`Status atualizado para: ${label[status] || status}`);
    } catch (err) {
      console.error("Update status error", err);
      setToast(err instanceof Error ? err.message : "Erro ao atualizar status.");
    } finally {
      setUpdating(false);
      setTimeout(() => setToast(""), 2200);
    }
  };

  const sendSupportRequest = async (e: FormEvent) => {
    e.preventDefault();
    if (!supportText.trim()) return;
    setUpdating(true);
    try {
      const supportNote = `[SOLICITAÇÃO DE APOIO EM ${new Date().toLocaleDateString("pt-BR")}] - ${supportText}`;
      const newNotes = notes ? `${notes}\n\n${supportNote}` : supportNote;

      // Save appointment notes update
      await apiFetch("/api/data?resource=appointments", {
        method: "PATCH",
        body: JSON.stringify({ id, notes: newNotes })
      });

      // Also register a client note for admin audit/attention
      await apiFetch("/api/portal?resource=client-note", {
        method: "POST",
        body: JSON.stringify({ clientId: a.client_id, note: supportNote })
      });

      setNotes(newNotes);
      setSupportText("");
      setSupportModalOpen(false);
      await p.reload();
      setToast("Solicitação de apoio registrada e enviada ao administrador.");
    } catch (err) {
      console.error("Support request error", err);
      setToast(err instanceof Error ? err.message : "Erro ao enviar solicitação.");
    } finally {
      setUpdating(false);
      setTimeout(() => setToast(""), 2200);
    }
  };

  return (
    <div>
      <Toast show={!!toast} message={toast} />

      <div className="mb-4">
        <a href="/profissional/agenda" className="text-xs font-bold text-champagne flex items-center gap-1">
          ← Voltar para a Agenda
        </a>
      </div>

      <PageHeader
        eyebrow="DETALHES DO AGENDAMENTO"
        title={`${a.client_whatsapp_title || a.client_name || 'Cliente'}`}
        subtitle={`${a.service_name} • ${dt(a.starts_at)}`}
        action={
          <div className="flex gap-2">
            <button
              onClick={() => setSupportModalOpen(true)}
              className="btn-secondary text-rose-500 border-rose-500/20"
            >
              Solicitar Apoio Admin
            </button>

            {a.status === "confirmed" && (
              <button
                disabled={updating}
                onClick={() => updateStatus("in_service")}
                className="btn-primary"
              >
                Iniciar Atendimento
              </button>
            )}

            {a.status === "in_service" && (
              <button
                disabled={updating}
                onClick={() => updateStatus("completed")}
                className="btn-primary bg-green-600 hover:bg-green-700"
              >
                Finalizar Atendimento
              </button>
            )}
          </div>
        }
      />

      <div className="grid gap-5 lg:grid-cols-[1fr_350px]">
        {/* Main Column */}
        <div className="space-y-5">
          {/* Details Card */}
          <section className="surface p-6">
            <SectionHeading title="Informações Gerais" />
            <div className="grid gap-4 sm:grid-cols-2 text-xs">
              <div>
                <span className="text-stone-400 block">Status Atual</span>
                <span className="font-bold">
                  <Badge tone={tone(a.status)}>{label[a.status] || a.status}</Badge>
                </span>
              </div>
              <div>
                <span className="text-stone-400 block">Duração Estimada</span>
                <span className="font-bold">{a.duration_minutes || 60} minutos</span>
              </div>
              <div>
                <span className="text-stone-400 block">Valor Estimado</span>
                <span className="font-bold">{brl(a.estimated_value)}</span>
              </div>
              <div>
                <span className="text-stone-400 block">Criado em</span>
                <span className="font-bold">{dt(a.created_at)}</span>
              </div>
            </div>
          </section>

          {/* Quick Notes (Observação rápida) */}
          <section className="surface p-6">
            <SectionHeading title="Observação rápida do agendamento" />
            <p className="text-[11px] text-stone-400 mb-3">
              Estas notas são de uso rápido e interno para o agendamento atual.
            </p>
            <textarea
              className="field min-h-24 py-3 text-xs"
              placeholder="Digite alguma observação sobre o andamento, preferências ou ocorrências..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
            <div className="mt-3 flex justify-end">
              <button
                disabled={updating}
                onClick={saveNotes}
                className="btn-primary !min-h-9 !px-4 text-xs"
              >
                {updating ? "Salvando..." : "Salvar observação rápida"}
              </button>
            </div>
          </section>

          {/* Diagnosis / Intake Data */}
          {a.intake_data && a.intake_data.answers && (
            <section className="surface p-6">
              <SectionHeading title="Diagnóstico Prévio (Intake)" />
              <div className="grid gap-3 sm:grid-cols-2">
                {Object.entries(a.intake_data.answers).map(([key, val]: any) => (
                  <div key={key} className="rounded-2xl bg-warm p-4 text-xs">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-stone-400 block mb-1">
                      {key}
                    </span>
                    <span className="font-bold">{val}</span>
                  </div>
                ))}
              </div>
              {a.intake_data.photos && a.intake_data.photos.filter(Boolean).length > 0 && (
                <div className="mt-4">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-stone-400 block mb-2">
                    Fotos anexadas
                  </span>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {a.intake_data.photos.filter(Boolean).map((url: string, idx: number) => (
                      <a
                        key={idx}
                        href={url}
                        target="_blank"
                        rel="noreferrer"
                        className="relative block aspect-[3/4] rounded-2xl overflow-hidden border border-black/5"
                      >
                        <img src={url} alt={`Intake ${idx}`} className="absolute inset-0 w-full h-full object-cover" />
                      </a>
                    ))}
                  </div>
                </div>
              )}
            </section>
          )}

          {/* Status History */}
          <section className="surface p-6">
            <SectionHeading title="Histórico de alterações" />
            <div className="space-y-4">
              {history.length ? (
                history.map((h: any) => (
                  <div key={h.id} className="border-b border-black/5 pb-3 last:border-0 last:pb-0 text-xs">
                    <div className="flex justify-between items-center mb-1">
                      <span className="font-bold text-stone-600">
                        {label[h.from_status] || h.from_status} → {label[h.to_status] || h.to_status}
                      </span>
                      <span className="text-[10px] text-stone-400">{dt(h.created_at)}</span>
                    </div>
                    {h.note && <p className="text-stone-500 italic">Nota: {h.note}</p>}
                    <p className="text-[10px] text-stone-400">Por: {h.actor || "Sistema"}</p>
                  </div>
                ))
              ) : (
                <p className="text-xs text-stone-400">Nenhuma alteração registrada.</p>
              )}
            </div>
          </section>
        </div>

        {/* Sidebar Column */}
        <div className="space-y-5">
          {/* Client Profile Card */}
          <section className="surface p-6 text-center">
            <div className="flex justify-center">
              <Avatar src={a.client_avatar_url} name={a.client_name} size="lg" />
            </div>
            <h3 className="mt-4 font-display text-2xl font-bold">{a.client_whatsapp_title || a.client_name || 'Cliente'}</h3>
            {a.client_name && a.client_name !== a.client_whatsapp_title && (
              <span className="text-xs font-semibold text-stone-400 block mt-1">
                Nome: {a.client_name}
              </span>
            )}

            <div className="mt-4 text-left text-xs space-y-2 border-t border-black/5 pt-4">
              {clientProfile.phone && (
                <div>
                  <span className="text-stone-400 block">Telefone</span>
                  <span className="font-bold">{clientProfile.phone}</span>
                </div>
              )}
              {clientProfile.instagram && (
                <div>
                  <span className="text-stone-400 block">Instagram</span>
                  <span className="font-bold">@{clientProfile.instagram}</span>
                </div>
              )}
              <div>
                <span className="text-stone-400 block">Preferências de Contato</span>
                <span className="font-bold">
                  {Object.entries(clientProfile.notification_preferences || {})
                    .filter(([_, active]) => active)
                    .map(([key]) => key.toUpperCase())
                    .join(" • ") || "Nenhuma"}
                </span>
              </div>
            </div>

            <div className="mt-5">
              <a
                href={`/profissional/clientes/${a.client_id}`}
                className="block w-full btn-secondary text-center py-2 text-xs"
              >
                Ver Histórico Completo
              </a>
            </div>
          </section>

          {/* Technical Record link */}
          <section className="surface p-6 text-center">
            <h4 className="font-bold text-xs uppercase tracking-wider text-stone-400">Ficha Técnica</h4>
            {p.data.record ? (
              <div className="mt-3 space-y-2">
                <p className="text-xs text-stone-500">
                  Uma ficha técnica já está registrada para este atendimento.
                </p>
                <a
                  href="/profissional/fichas"
                  className="block w-full btn-secondary py-2 text-xs"
                >
                  Abrir Fichas Técnicas
                </a>
              </div>
            ) : (
              <div className="mt-3 space-y-2">
                <p className="text-xs text-stone-500">
                  Nenhuma ficha técnica registrada para este atendimento ainda.
                </p>
                <a
                  href="/profissional/fichas"
                  className="block w-full btn-primary py-2 text-xs text-white"
                >
                  Preencher Ficha Técnica
                </a>
              </div>
            )}
          </section>
        </div>
      </div>

      {/* Modal Solicitar Apoio Admin */}
      <Modal open={supportModalOpen} onClose={() => { if (!updating) setSupportModalOpen(false); }} title="Solicitar Apoio do Admin">
        <form onSubmit={sendSupportRequest} className="space-y-4">
          <label className="block">
            <span className="mb-2 block text-xs font-bold">Descreva sua solicitação / dúvida de apoio</span>
            <textarea
              required
              className="field min-h-24 py-3"
              placeholder="Ex: Preciso de auxílio com a quantidade do lote ou com o faturamento desta cliente..."
              value={supportText}
              onChange={(e) => setSupportText(e.target.value)}
            />
          </label>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={updating}
              onClick={() => setSupportModalOpen(false)}
              className="btn-secondary flex-1"
            >
              Cancelar
            </button>
            <button
              disabled={updating || !supportText.trim()}
              className="btn-primary flex-1"
            >
              {updating ? "Enviando..." : "Confirmar Solicitação"}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

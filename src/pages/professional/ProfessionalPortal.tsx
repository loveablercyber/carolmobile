import { FormEvent, useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { CalendarDays, Camera, CircleDollarSign, Clock3, FileText, Plus, Save, Star, Target, Users, WalletCards } from 'lucide-react'
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
- Comprimento: ${form.lengthCm ? `${form.lengthCm}cm` : 'Não informado'}
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
                    {x.lot} ({x.category} • {x.color} • {x.length_cm}cm • {x.quantity} un)
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
          <TechnicalInput disabled={!!form.hairInventoryId} label="Comprimento (cm)" type="number" value={form.lengthCm} set={v=>setForm({...form,lengthCm:v})}/>
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

function TechnicalInput({label,value,set,type='text',disabled=false}:{label:string;value:string;set:(v:string)=>void;type?:string;disabled?:boolean}){return <label className="block"><span className="mb-2 block text-xs font-bold">{label}</span><input disabled={disabled} className="field disabled:opacity-60" min={type==='number'?'0':undefined} step={type==='number'?'any':undefined} type={type} value={value} onChange={e=>set(e.target.value)}/></label>}

export function ProfessionalAvailabilityPage(){const p=useLoad<any>('/api/portal?resource=professional-availability');const[open,setOpen]=useState(false);const[form,setForm]=useState({date:'',start:'09:00',end:'10:00',reason:''});const[toast,setToast]=useState('');const[saving,setSaving]=useState(false);if(p.loading)return <LoadingState/>;const block=async(e:FormEvent)=>{e.preventDefault();setSaving(true);try{await apiFetch('/api/portal?resource=blocked-schedule',{method:'POST',body:JSON.stringify({startsAt:`${form.date}T${form.start}:00-03:00`,endsAt:`${form.date}T${form.end}:00-03:00`,reason:form.reason})});await p.reload();setOpen(false);setToast('Horário bloqueado com sucesso.')}catch(err){console.error('Blocked schedule error',err);setToast(err instanceof Error?err.message:'Não foi possível concluir a ação.')}finally{setSaving(false);setTimeout(()=>setToast(''),2200)}};const days=['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];return <div><Toast show={!!toast} message={toast}/><PageHeader eyebrow="DISPONIBILIDADE" title="Jornada e bloqueios" subtitle="Controle seus horários sem alterar a agenda de outras profissionais." action={<button onClick={()=>setOpen(true)} className="btn-primary"><Clock3 size={15}/>Bloquear período</button>}/><div className="grid gap-5 lg:grid-cols-2"><section className="surface p-6"><SectionHeading title="Jornada semanal"/>{p.data?.availability?.length?p.data.availability.map((x:any)=><div key={x.id} className="flex justify-between border-b border-black/5 py-3 text-xs"><b>{days[x.weekday]}</b><span>{String(x.starts_at).slice(0,5)}–{String(x.ends_at).slice(0,5)}</span></div>):<EmptyState title="Jornada não configurada" text="O administrador ainda não definiu seus horários padrão."/>}</section><section className="surface p-6"><SectionHeading title="Próximos bloqueios"/>{p.data?.blocked?.length?p.data.blocked.map((x:any)=><div key={x.id} className="border-b border-black/5 py-3"><b className="text-xs">{x.reason||'Bloqueio'}</b><span className="block text-[10px] text-stone-400">{dt(x.starts_at)} até {dt(x.ends_at)}</span></div>):<EmptyState title="Nenhum bloqueio" text="Sua disponibilidade está livre."/>}</section></div><Modal open={open} onClose={()=>{if(!saving)setOpen(false)}} title="Bloquear período"><form onSubmit={block} className="space-y-4"><Input label="Data" type="date" value={form.date} set={v=>setForm({...form,date:v})}/><div className="grid grid-cols-2 gap-3"><Input label="Início" type="time" value={form.start} set={v=>setForm({...form,start:v})}/><Input label="Fim" type="time" value={form.end} set={v=>setForm({...form,end:v})}/></div><Input label="Motivo" value={form.reason} set={v=>setForm({...form,reason:v})}/><button disabled={saving} className="btn-primary w-full">{saving?'Salvando…':'Salvar bloqueio'}</button></form></Modal></div>}

export function ProfessionalProfilePage(){const{refresh}=useAuth();const p=useLoad<any>('/api/portal?resource=profile');const[form,setForm]=useState<any>({});const[saving,setSaving]=useState(false);const[toast,setToast]=useState('');useEffect(()=>{if(p.data)setForm({fullName:p.data.full_name,email:p.data.email,phone:p.data.phone||'',birthDate:p.data.birth_date?.slice(0,10)||'',instagram:p.data.instagram||'',address:p.data.address||{},avatarUrl:p.data.avatar_url||'',bio:p.data.bio||'',specialties:p.data.specialties||[]})},[p.data]);if(p.loading)return <LoadingState/>;const save=async(e:FormEvent)=>{e.preventDefault();setSaving(true);try{await apiFetch('/api/portal?resource=profile',{method:'PATCH',body:JSON.stringify(form)});await Promise.all([p.reload(),refresh()]);setToast('Alterações salvas com sucesso.')}catch(err){console.error('Professional profile error',err);setToast(err instanceof Error?err.message:'Ocorreu um erro ao salvar os dados.')}finally{setSaving(false);setTimeout(()=>setToast(''),2200)}};return <div><Toast show={!!toast} message={toast}/><PageHeader eyebrow="PERFIL PROFISSIONAL" title={p.data?.full_name||'Perfil'} subtitle="Dados, biografia e especialidades persistidos no Neon."/><form onSubmit={save} className="grid gap-5 lg:grid-cols-[300px_1fr]"><aside className="surface p-7 text-center"><Avatar src={form.avatarUrl} name={form.fullName||''} size="lg"/><h2 className="mt-4 font-display text-3xl">{form.fullName}</h2><p className="muted mt-2">{p.data?.active?'Profissional ativa':'Profissional inativa'}</p></aside><section className="surface p-6"><div className="grid gap-4 sm:grid-cols-2"><Input label="Nome" value={form.fullName||''} set={v=>setForm({...form,fullName:v})}/><Input label="E-mail" type="email" value={form.email||''} set={v=>setForm({...form,email:v})}/><Input label="Telefone" value={form.phone||''} set={v=>setForm({...form,phone:v})}/><Input label="Instagram" value={form.instagram||''} set={v=>setForm({...form,instagram:v})}/></div><label className="mt-4 block"><span className="mb-2 block text-xs font-bold">Biografia</span><textarea className="field min-h-24 py-3" value={form.bio||''} onChange={e=>setForm({...form,bio:e.target.value})}/></label><label className="mt-4 block"><span className="mb-2 block text-xs font-bold">Especialidades, separadas por vírgula</span><input className="field" value={(form.specialties||[]).join(', ')} onChange={e=>setForm({...form,specialties:e.target.value.split(',').map(x=>x.trim()).filter(Boolean)})}/></label><button disabled={saving} className="btn-primary mt-5"><Save size={15}/>{saving?'Salvando…':'Salvar perfil'}</button></section></form></div>}

export function ProfessionalClientDetailPage(){const id=useLocation().pathname.split('/clientes/')[1];const p=useLoad<any>(`/api/portal?resource=client-detail&id=${encodeURIComponent(id||'')}`);const[note,setNote]=useState('');const[toast,setToast]=useState('');if(p.loading)return <LoadingState/>;if(!p.data)return <EmptyState title="Cliente indisponível" text={p.error||'Esta cliente não está vinculada à sua agenda.'}/>;const d=p.data;const add=async()=>{try{await apiFetch('/api/portal?resource=client-note',{method:'POST',body:JSON.stringify({clientId:id,note})});setNote('');await p.reload();setToast('Observação adicionada.')}catch(err){console.error('Professional client note error',err);setToast(err instanceof Error?err.message:'Não foi possível concluir a ação.')}finally{setTimeout(()=>setToast(''),2200)}};return <div><Toast show={!!toast} message={toast}/><PageHeader eyebrow="CLIENTE VINCULADA" title={d.profile.full_name} subtitle={`${d.profile.phone||'Sem telefone'} • histórico limitado aos seus atendimentos`}/><div className="grid gap-5 lg:grid-cols-[320px_1fr]"><aside className="surface p-6 text-center"><Avatar src={d.profile.avatar_url} name={d.profile.full_name} size="lg"/><h2 className="mt-4 font-display text-3xl">{d.profile.full_name}</h2><p className="muted mt-2">Preferências: {Object.values(d.profile.preferences||{}).join(' • ')||'Não informadas'}</p></aside><section className="surface p-6"><SectionHeading title="Atendimentos vinculados"/>{d.appointments.length?d.appointments.map((a:any)=><div key={a.id} className="flex justify-between border-b border-black/5 py-4"><span><b className="block text-xs">{a.service}</b><span className="text-[10px] text-stone-400">{dt(a.starts_at)}</span></span><Badge tone={tone(a.status)}>{label[a.status]||a.status}</Badge></div>):<EmptyState title="Nenhum atendimento" text="Não há histórico permitido."/>}<SectionHeading title="Observações autorizadas"/>{d.notes.map((n:any)=><div key={n.id} className="border-b border-black/5 py-3"><b className="text-xs">{n.author}</b><p className="text-[11px] text-stone-500">{n.note}</p></div>)}<div className="mt-4 flex gap-2"><input className="field" value={note} onChange={e=>setNote(e.target.value)} placeholder="Adicionar observação"/><button disabled={note.trim().length<3} onClick={add} className="btn-primary">Salvar</button></div></section></div></div>}

function Input({label,value,set,type='text'}:{label:string;value:string;set:(v:string)=>void;type?:string}){return <label className="block"><span className="mb-2 block text-xs font-bold">{label}</span><input className="field" required type={type} value={value} onChange={e=>set(e.target.value)}/></label>}

export const images = {
  hero: 'https://images.unsplash.com/photo-1524504388940-b1c1722653e1?auto=format&fit=crop&w=1400&q=88',
  brunette: 'https://images.unsplash.com/photo-1595476108010-b4d1f102b1b1?auto=format&fit=crop&w=900&q=85',
  blonde: 'https://images.unsplash.com/photo-1519699047748-de8e457a634e?auto=format&fit=crop&w=900&q=85',
  curls: 'https://images.unsplash.com/photo-1487412720507-e7ab37603c6f?auto=format&fit=crop&w=900&q=85',
  salon: 'https://images.unsplash.com/photo-1560066984-138dadb4c035?auto=format&fit=crop&w=1200&q=85',
  product: 'https://images.unsplash.com/photo-1522338242992-e1a54906a8da?auto=format&fit=crop&w=900&q=85',
  stylist1: 'https://images.unsplash.com/photo-1551836022-d5d88e9218df?auto=format&fit=crop&w=300&q=80',
  stylist2: 'https://images.unsplash.com/photo-1580489944761-15a19d654956?auto=format&fit=crop&w=300&q=80',
  client1: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=300&q=80',
  client2: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=300&q=80'
}

export const services = [
  { id: 'fita', name: 'Fita Adesiva', description: 'Leve, discreta e perfeita para um efeito natural.', duration: '3h30', price: 950, image: images.brunette, tag: 'Mais escolhido' },
  { id: 'microlink', name: 'Microlink', description: 'Aplicação sem cola com movimento e versatilidade.', duration: '4h', price: 1250, image: images.curls, tag: 'Sem química' },
  { id: 'queratina', name: 'Queratina', description: 'Mechas precisas para liberdade e longa duração.', duration: '5h', price: 1100, image: images.blonde },
  { id: 'tictac', name: 'Tic Tac', description: 'Transformação temporária para ocasiões especiais.', duration: '1h', price: 950, image: images.hero },
  { id: 'manutencao', name: 'Manutenção', description: 'Reposicionamento, higienização e finalização.', duration: '2h30', price: 250, image: images.salon, tag: 'Recorrente' },
  { id: 'remocao', name: 'Remoção Segura', description: 'Retirada técnica preservando seus fios naturais.', duration: '1h30', price: 200, image: images.product }
]

export const appointments = [
  { time: '09:00', client: 'Beatriz Lima', service: 'Manutenção Fita Adesiva', duration: '2h30', status: 'Confirmado', value: 'R$ 420', photo: images.client1 },
  { time: '12:00', client: 'Marina Costa', service: 'Avaliação personalizada', duration: '45min', status: 'Aguardando sinal', value: 'R$ 80', photo: images.client2 },
  { time: '14:30', client: 'Camila Ferreira', service: 'Aplicação Microlink', duration: '4h', status: 'Confirmado', value: 'R$ 1.680', photo: images.stylist2 },
  { time: '18:30', client: 'Ana Clara Souza', service: 'Finalização premium', duration: '1h', status: 'Confirmado', value: 'R$ 180', photo: images.client1 }
]

export const clients = [
  { name: 'Camila Ferreira', phone: '(11) 99845-2201', last: '14/06/2026', next: '24/06/2026', ticket: 'R$ 1.460', points: 850, tag: 'VIP', photo: images.client1 },
  { name: 'Marina Costa', phone: '(11) 99218-7734', last: '03/05/2026', next: '—', ticket: 'R$ 980', points: 420, tag: 'Manutenção atrasada', photo: images.client2 },
  { name: 'Beatriz Lima', phone: '(11) 97122-0983', last: '18/06/2026', next: '18/07/2026', ticket: 'R$ 720', points: 610, tag: 'Recorrente', photo: images.stylist2 },
  { name: 'Ana Clara Souza', phone: '(11) 98856-1344', last: '11/06/2026', next: '02/07/2026', ticket: 'R$ 1.890', points: 1040, tag: 'Alto ticket', photo: images.stylist1 }
]

export const inventory = [
  { code: 'CAB-4571', item: 'Cabelo humano premium', detail: 'Castanho 4 • 60 cm • Liso', lot: 'CS2604', qty: 8, min: 5, cost: 'R$ 680', margin: '48%', status: 'Em estoque' },
  { code: 'FIT-2110', item: 'Fita adesiva invisível', detail: 'Loiro 8.1 • 55 cm • Ondulado', lot: 'CS2602', qty: 3, min: 6, cost: 'R$ 520', margin: '52%', status: 'Estoque baixo' },
  { code: 'MIC-0812', item: 'Microlink premium', detail: 'Morena iluminada • 65 cm', lot: 'CS2605', qty: 12, min: 4, cost: 'R$ 790', margin: '46%', status: 'Em estoque' },
  { code: 'PRO-3301', item: 'Kit home care Carol Sol', detail: 'Shampoo + máscara + sérum', lot: 'CS2606', qty: 21, min: 8, cost: 'R$ 118', margin: '61%', status: 'Em estoque' }
]

export const professionals = [
  { name: 'Juliana Almeida', specialty: 'Especialista em Fita e Microlink', rating: 4.9, photo: images.stylist2, agenda: 'Disponível 14:00' },
  { name: 'Renata Moura', specialty: 'Colorista e extensões', rating: 4.8, photo: images.stylist1, agenda: 'Disponível 16:30' }
]

export const notifications = [
  { title: 'Agendamento confirmado', text: 'Manutenção com Juliana em 24/06 às 14:00.', time: 'Agora', unread: true },
  { title: 'Você ganhou 120 pontos', text: 'Seu atendimento de 18/06 já rendeu novos benefícios.', time: '2h', unread: true },
  { title: 'Cuidado da semana', text: 'Evite dormir com os fios úmidos para proteger a fixação.', time: 'Ontem', unread: false }
]

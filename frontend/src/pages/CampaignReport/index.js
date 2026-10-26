import React, { useEffect, useRef, useState, useContext } from "react";
import { useParams } from "react-router-dom";

import { makeStyles } from "@material-ui/core/styles";
import Paper from "@material-ui/core/Paper";

import MainContainer from "../../components/MainContainer";
import MainHeader from "../../components/MainHeader";
import Title from "../../components/Title";

import {
  Grid,
  LinearProgress,
  Typography,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Chip,
  Button
} from "@material-ui/core";
import GetAppIcon from "@material-ui/icons/GetApp";
import SmartphoneIcon from "@material-ui/icons/Smartphone";
import { IconButton } from "@material-ui/core";
import Papa from "papaparse";
import api from "../../services/api";
import CampaignPhonePreview from "../../components/CampaignPhonePreview";
import { has, get, isNull } from "lodash";
import CardCounter from "../../components/Dashboard/CardCounter";
import GroupIcon from "@material-ui/icons/Group";
import ScheduleIcon from "@material-ui/icons/Schedule";
import EventAvailableIcon from "@material-ui/icons/EventAvailable";
import DoneIcon from "@material-ui/icons/Done";
import DoneAllIcon from "@material-ui/icons/DoneAll";
import CheckCircleIcon from "@material-ui/icons/CheckCircle";
import WhatsAppIcon from "@material-ui/icons/WhatsApp";
import ListAltIcon from "@material-ui/icons/ListAlt";
import { useDate } from "../../hooks/useDate";

import { SocketContext } from "../../context/Socket/SocketContext";

const useStyles = makeStyles(theme => ({
  mainPaper: {
    flex: 1,
    padding: theme.spacing(2),
    overflowY: "scroll",
    ...theme.scrollbarStyles
  },
  textRight: {
    textAlign: "right"
  },
  tabPanelsContainer: {
    padding: theme.spacing(2)
  },
  // Bolha de conversa (como o cliente recebeu).
  chatWrap: {
    background:
      theme.palette.type === "dark" ? "#0b141a" : "#e5ddd5",
    padding: theme.spacing(2),
    borderRadius: 8,
    display: "flex",
    justifyContent: "flex-start"
  },
  bubble: {
    maxWidth: 420,
    width: "100%",
    background: theme.palette.type === "dark" ? "#202c33" : "#ffffff",
    borderRadius: 10,
    overflow: "hidden",
    boxShadow: "0 1px 1px rgba(0,0,0,0.2)"
  },
  bubbleImg: {
    width: "100%",
    display: "block"
  },
  bubbleBody: {
    padding: "8px 10px 4px 10px",
    whiteSpace: "pre-wrap",
    fontFamily: "inherit",
    fontSize: 14,
    margin: 0,
    color: theme.palette.type === "dark" ? "#e9edef" : "#111b21"
  },
  bubbleFooter: {
    padding: "0 10px 8px 10px",
    fontSize: 12,
    color: theme.palette.type === "dark" ? "#8696a0" : "#667781"
  },
  bubbleBtn: {
    borderTop: `1px solid ${
      theme.palette.type === "dark" ? "#2a3942" : "#e9edef"
    }`,
    padding: "10px",
    textAlign: "center",
    color: "#00a5f4",
    fontSize: 14,
    fontWeight: 500
  }
}));

const CampaignReport = () => {
  const classes = useStyles();

  const { campaignId } = useParams();

  const [campaign, setCampaign] = useState({});
  const [validContacts, setValidContacts] = useState(0);
  const [delivered, setDelivered] = useState(0);
  const [confirmationRequested, setConfirmationRequested] = useState(0);
  const [confirmed, setConfirmed] = useState(0);
  const [percent, setPercent] = useState(0);
  const [loading, setLoading] = useState(false);
  const [messagePreview, setMessagePreview] = useState("");
  const [template, setTemplate] = useState(null);
  const [shippings, setShippings] = useState([]);
  const [shippingSummary, setShippingSummary] = useState({});
  const [loadingShippings, setLoadingShippings] = useState(false);
  const [phoneRecipient, setPhoneRecipient] = useState(null);
  const mounted = useRef(true);

  const { datetimeToClient } = useDate();

  const socketManager = useContext(SocketContext);

  useEffect(() => {
    if (mounted.current) {
      findCampaign();
      findShippings();
    }

    return () => {
      mounted.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setPercent((delivered / validContacts) * 100);
  }, [delivered, validContacts]);

  useEffect(() => {
    const companyId = localStorage.getItem("companyId");
    const socket = socketManager.GetSocket(companyId);

    const onCampaign = data => {
      if (data.campaign?.id === +campaignId) {
        setCampaign(data.campaign);
        setValidContacts(data.valids);
        setConfirmationRequested(data.confirmationRequested);
        setConfirmed(data.confirmed);
        setDelivered(data.delivered);

        if (data.campaign.status === "FINALIZADA") {
          setTimeout(() => {
            findCampaign();
          }, 5000);
        }
      }
    };

    socket.on(`company-${companyId}-campaign`, onCampaign);

    return () => {
      socket.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaignId, socketManager]);

  const findCampaign = async () => {
    setLoading(true);
    const { data } = await api.get(`/campaigns/${campaignId}`);
    setCampaign(data.campaign);
    setValidContacts(data.valids);
    setConfirmationRequested(data.confirmationRequested);
    setConfirmed(data.confirmed);
    setDelivered(data.delivered);
    setLoading(false);
  };

  const findShippings = async () => {
    setLoadingShippings(true);
    try {
      const { data } = await api.get(`/campaigns/${campaignId}/shippings`);
      setMessagePreview(data.messagePreview || "");
      setTemplate(data.template || null);
      setShippings(Array.isArray(data.rows) ? data.rows : []);
      setShippingSummary({
        total: data.total,
        sent: data.sent,
        delivered: data.delivered,
        read: data.read,
        failed: data.failed
      });
    } catch (err) {
      // best-effort: relatório de disparos é complementar
    }
    setLoadingShippings(false);
  };

  // Status real da Meta -> rótulo/cor para auditoria.
  const ackLabel = row => {
    if (row.ackFailedAt || row.ackStatus === "failed") return "Falhou";
    if (row.ackReadAt || row.ackStatus === "read") return "Lido";
    if (row.ackDeliveredAt || row.ackStatus === "delivered") return "Entregue";
    if (row.deliveredAt || row.ackStatus === "sent") return "Enviado";
    return "Pendente";
  };

  const ackColor = row => {
    const label = ackLabel(row);
    if (label === "Lido") return "primary";
    if (label === "Falhou") return "secondary";
    return "default";
  };

  const exportCsv = () => {
    const toBr = v => (v ? datetimeToClient(v) : "");
    const rows = shippings.map(r => ({
      Nome: r.name,
      Numero: r.number,
      Status: ackLabel(r),
      "Enviado em": toBr(r.deliveredAt),
      "Entregue em": toBr(r.ackDeliveredAt),
      "Lido em": toBr(r.ackReadAt),
      "Falhou em": toBr(r.ackFailedAt),
      "Motivo da falha": r.failReason || "",
      Mensagem: r.message || "",
      Origem: r.messageExact ? "capturada no envio" : "reconstruída",
      wamid: r.wamid || ""
    }));
    const csv = Papa.unparse(rows, { delimiter: ";" });
    // BOM para o Excel abrir com acentuação correta.
    const blob = new Blob(["﻿" + csv], {
      type: "text/csv;charset=utf-8;"
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `campanha-${campaignId}-disparos.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const formatStatus = val => {
    switch (val) {
      case "INATIVA":
        return "Inativa";
      case "PROGRAMADA":
        return "Programada";
      case "EM_ANDAMENTO":
        return "Em Andamento";
      case "CANCELADA":
        return "Cancelada";
      case "FINALIZADA":
        return "Finalizada";
      default:
        return val;
    }
  };

  return (
    <MainContainer>
      <MainHeader>
        <Grid style={{ width: "99.6%" }} container>
          <Grid xs={12} item>
            <Title>Relatório da {campaign.name || "Campanha"}</Title>
          </Grid>
        </Grid>
      </MainHeader>
      <Paper className={classes.mainPaper} variant="outlined">
        <Typography variant="h6" component="h2">
          Status: {formatStatus(campaign.status)} {delivered} de {validContacts}
        </Typography>
        <Grid spacing={2} container>
          <Grid xs={12} item>
            <LinearProgress
              variant="determinate"
              style={{ height: 15, borderRadius: 3, margin: "20px 0" }}
              value={percent}
            />
          </Grid>
          <Grid xs={12} md={4} item>
            <CardCounter
              icon={<GroupIcon fontSize="inherit" />}
              title="Contatos Válidos"
              value={validContacts}
              loading={loading}
            />
          </Grid>
          {campaign.confirmation && (
            <>
              <Grid xs={12} md={4} item>
                <CardCounter
                  icon={<DoneIcon fontSize="inherit" />}
                  title="Confirmações Solicitadas"
                  value={confirmationRequested}
                  loading={loading}
                />
              </Grid>
              <Grid xs={12} md={4} item>
                <CardCounter
                  icon={<DoneAllIcon fontSize="inherit" />}
                  title="Confirmações"
                  value={confirmed}
                  loading={loading}
                />
              </Grid>
            </>
          )}
          <Grid xs={12} md={4} item>
            <CardCounter
              icon={<CheckCircleIcon fontSize="inherit" />}
              title="Entregues"
              value={delivered}
              loading={loading}
            />
          </Grid>
          {campaign.whatsappId && (
            <Grid xs={12} md={4} item>
              <CardCounter
                icon={<WhatsAppIcon fontSize="inherit" />}
                title="Conexão"
                value={campaign.whatsapp.name}
                loading={loading}
              />
            </Grid>
          )}
          {campaign.contactListId && (
            <Grid xs={12} md={4} item>
              <CardCounter
                icon={<ListAltIcon fontSize="inherit" />}
                title="Lista de Contatos"
                value={campaign.contactList.name}
                loading={loading}
              />
            </Grid>
          )}
          <Grid xs={12} md={4} item>
            <CardCounter
              icon={<ScheduleIcon fontSize="inherit" />}
              title="Agendamento"
              value={datetimeToClient(campaign.scheduledAt)}
              loading={loading}
            />
          </Grid>
          <Grid xs={12} md={4} item>
            <CardCounter
              icon={<EventAvailableIcon fontSize="inherit" />}
              title="Conclusão"
              value={datetimeToClient(campaign.completedAt)}
              loading={loading}
            />
          </Grid>
        </Grid>
      </Paper>

      <Paper
        className={classes.mainPaper}
        variant="outlined"
        style={{ marginTop: 12 }}
      >
        <Typography variant="h6" component="h2" gutterBottom>
          Mensagem enviada (como o cliente recebeu)
        </Typography>
        <div className={classes.chatWrap}>
          <div className={classes.bubble}>
            {template?.headerImageUrl && (
              <img
                src={template.headerImageUrl}
                alt="imagem da campanha"
                className={classes.bubbleImg}
              />
            )}
            <div className={classes.bubbleBody}>
              {template?.headerText && (
                <div style={{ fontWeight: 700, marginBottom: 4 }}>
                  {template.headerText}
                </div>
              )}
              {(template?.body || messagePreview || "—")}
            </div>
            {template?.footer && (
              <div className={classes.bubbleFooter}>{template.footer}</div>
            )}
            {(template?.buttons || []).map((b, i) => (
              <div key={i} className={classes.bubbleBtn}>
                {b}
              </div>
            ))}
          </div>
        </div>

        <Grid
          container
          justifyContent="space-between"
          alignItems="center"
          style={{ marginTop: 20 }}
        >
          <Typography variant="h6" component="h2">
            Destinatários ({shippings.length}) — enviados{" "}
            {shippingSummary.sent || 0}, entregues{" "}
            {shippingSummary.delivered || 0}, lidos {shippingSummary.read || 0}
            {shippingSummary.failed ? `, falhas ${shippingSummary.failed}` : ""}
          </Typography>
          <Button
            variant="outlined"
            size="small"
            startIcon={<GetAppIcon />}
            onClick={exportCsv}
            disabled={!shippings.length}
          >
            Exportar CSV
          </Button>
        </Grid>
        {loadingShippings && <LinearProgress style={{ marginBottom: 8 }} />}
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Nome</TableCell>
              <TableCell>Número</TableCell>
              <TableCell align="center">Status</TableCell>
              <TableCell align="center">Enviado</TableCell>
              <TableCell align="center">Entregue</TableCell>
              <TableCell align="center">Lido</TableCell>
              <TableCell>Mensagem</TableCell>
              <TableCell align="center">Conversa</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {shippings.map(row => (
              <TableRow key={row.id}>
                <TableCell>{row.name}</TableCell>
                <TableCell>{row.number}</TableCell>
                <TableCell align="center">
                  <Chip size="small" label={ackLabel(row)} color={ackColor(row)} />
                  {row.failReason && (
                    <Typography
                      variant="caption"
                      color="error"
                      display="block"
                    >
                      {row.failReason}
                    </Typography>
                  )}
                </TableCell>
                <TableCell align="center">
                  {row.deliveredAt ? datetimeToClient(row.deliveredAt) : "—"}
                </TableCell>
                <TableCell align="center">
                  {row.ackDeliveredAt
                    ? datetimeToClient(row.ackDeliveredAt)
                    : "—"}
                </TableCell>
                <TableCell align="center">
                  {row.ackReadAt ? datetimeToClient(row.ackReadAt) : "—"}
                </TableCell>
                <TableCell>
                  <Typography
                    variant="caption"
                    component="pre"
                    style={{
                      whiteSpace: "pre-wrap",
                      fontFamily: "inherit",
                      margin: 0
                    }}
                  >
                    {row.message}
                  </Typography>
                  {!row.messageExact && (
                    <Chip
                      size="small"
                      variant="outlined"
                      label="reconstruída"
                      style={{ marginTop: 4 }}
                    />
                  )}
                </TableCell>
                <TableCell align="center">
                  <IconButton
                    size="small"
                    title="Ver conversa (celular)"
                    onClick={() => setPhoneRecipient(row)}
                  >
                    <SmartphoneIcon />
                  </IconButton>
                </TableCell>
              </TableRow>
            ))}
            {!loadingShippings && shippings.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} align="center">
                  Nenhum disparo registrado.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Paper>

      <CampaignPhonePreview
        open={!!phoneRecipient}
        onClose={() => setPhoneRecipient(null)}
        recipient={phoneRecipient}
        template={template}
      />
    </MainContainer>
  );
};

export default CampaignReport;

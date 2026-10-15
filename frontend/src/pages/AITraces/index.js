import React, { useEffect, useState } from "react";

import { makeStyles } from "@material-ui/core/styles";
import { green, red, blue, orange } from "@material-ui/core/colors";
import {
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Grid,
  IconButton,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography
} from "@material-ui/core";
import { Refresh, Visibility } from "@material-ui/icons";

import MainContainer from "../../components/MainContainer";
import MainHeader from "../../components/MainHeader";
import MainHeaderButtonsWrapper from "../../components/MainHeaderButtonsWrapper";
import Title from "../../components/Title";
import TableRowSkeleton from "../../components/TableRowSkeleton";

import api from "../../services/api";
import { i18n } from "../../translate/i18n";
import toastError from "../../errors/toastError";

const useStyles = makeStyles(theme => ({
  mainPaper: {
    flex: 1,
    padding: theme.spacing(2),
    overflowY: "scroll",
    ...theme.scrollbarStyles
  },
  hint: { marginBottom: theme.spacing(2) },
  card: {
    padding: theme.spacing(1.5),
    textAlign: "center",
    height: "100%"
  },
  cardValue: { fontWeight: 700, fontSize: "1.3rem" },
  cardLabel: { color: theme.palette.text.secondary, fontSize: "0.8rem" },
  filterRow: {
    display: "flex",
    gap: 12,
    alignItems: "center",
    marginBottom: theme.spacing(2),
    flexWrap: "wrap"
  },
  toolChip: { margin: 2 },
  mono: { fontFamily: "monospace", whiteSpace: "pre-wrap", wordBreak: "break-word" },
  detailSection: { marginTop: theme.spacing(2) }
}));

const fmtUsd = v =>
  `US$ ${Number(v || 0).toLocaleString("en-US", {
    minimumFractionDigits: 4,
    maximumFractionDigits: 6
  })}`;

const fmtDate = s => {
  if (!s) return "";
  try {
    return new Date(s).toLocaleString("pt-BR");
  } catch {
    return s;
  }
};

const statusColor = status => {
  if (status === "error") return red[600];
  if (status === "transferred") return orange[700];
  return green[600];
};

const toolStatusColor = tc => {
  if (tc.blocked) return red[700];
  if (tc.isError) return orange[700];
  if (tc.status === "transfer") return blue[600];
  return green[600];
};

const AITraces = () => {
  const classes = useStyles();

  const [records, setRecords] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [ticketFilter, setTicketFilter] = useState("");
  const [detail, setDetail] = useState(null);

  const fetchSummary = async () => {
    try {
      const { data } = await api.get("/ai-agents-traces/summary", {
        params: { days: 30 }
      });
      setSummary(data);
    } catch (err) {
      // resumo é complementar; não derruba a tela
    }
  };

  const fetchTraces = async () => {
    setLoading(true);
    try {
      const params = { limit: 100 };
      if (ticketFilter) params.ticketId = ticketFilter;
      const { data } = await api.get("/ai-agents-traces", { params });
      setRecords(Array.isArray(data.records) ? data.records : []);
    } catch (err) {
      toastError(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSummary();
    fetchTraces();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleRefresh = () => {
    fetchSummary();
    fetchTraces();
  };

  const renderCard = (label, value) => (
    <Grid item xs={6} sm={4} md={2}>
      <Paper variant="outlined" className={classes.card}>
        <div className={classes.cardValue}>{value}</div>
        <div className={classes.cardLabel}>{label}</div>
      </Paper>
    </Grid>
  );

  const renderToolChips = toolCalls => {
    if (!Array.isArray(toolCalls) || !toolCalls.length) {
      return <span style={{ color: "#999" }}>—</span>;
    }
    return toolCalls.map((tc, i) => (
      <Chip
        key={i}
        size="small"
        className={classes.toolChip}
        label={`${tc.name}${tc.ms ? ` ${tc.ms}ms` : ""}`}
        style={{ backgroundColor: toolStatusColor(tc), color: "#fff" }}
      />
    ));
  };

  const contactLabel = r => {
    const c = r.ticket && r.ticket.contact;
    if (c && c.name) return c.name;
    if (c && c.number) return c.number;
    return r.ticketId ? `#${r.ticketId}` : "-";
  };

  return (
    <MainContainer>
      <Dialog
        open={!!detail}
        onClose={() => setDetail(null)}
        maxWidth="md"
        fullWidth
        scroll="paper"
      >
        {detail && (
          <>
            <DialogTitle>
              {i18n.t("aiTraces.detail.title")} — #{detail.id}
            </DialogTitle>
            <DialogContent dividers>
              <Grid container spacing={1}>
                {renderCard(i18n.t("aiTraces.cards.model"), detail.model || "-")}
                {renderCard(
                  i18n.t("aiTraces.table.tokens"),
                  `${detail.inputTokens}/${detail.outputTokens}`
                )}
                {renderCard(i18n.t("aiTraces.table.cost"), fmtUsd(detail.costUsd))}
                {renderCard(
                  i18n.t("aiTraces.table.latency"),
                  `${detail.latencyMs} ms`
                )}
                {renderCard(i18n.t("aiTraces.table.steps"), detail.steps)}
                {renderCard(
                  i18n.t("aiTraces.table.status"),
                  i18n.t(`aiTraces.status.${detail.status}`) || detail.status
                )}
              </Grid>

              <div className={classes.detailSection}>
                <Typography variant="subtitle2">
                  {i18n.t("aiTraces.detail.trajectory")}
                </Typography>
                {Array.isArray(detail.toolCalls) && detail.toolCalls.length ? (
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>{i18n.t("aiTraces.detail.tool")}</TableCell>
                        <TableCell>{i18n.t("aiTraces.table.status")}</TableCell>
                        <TableCell align="right">ms</TableCell>
                        <TableCell>{i18n.t("aiTraces.detail.reason")}</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {detail.toolCalls.map((tc, i) => (
                        <TableRow key={i}>
                          <TableCell>{tc.name}</TableCell>
                          <TableCell>
                            <Chip
                              size="small"
                              label={tc.status || (tc.isError ? "error" : "ok")}
                              style={{
                                backgroundColor: toolStatusColor(tc),
                                color: "#fff"
                              }}
                            />
                          </TableCell>
                          <TableCell align="right">{tc.ms || "-"}</TableCell>
                          <TableCell>{tc.reason || "-"}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                ) : (
                  <Typography variant="body2" color="textSecondary">
                    {i18n.t("aiTraces.detail.noTools")}
                  </Typography>
                )}
              </div>

              {Array.isArray(detail.guardrailEvents) &&
                detail.guardrailEvents.length > 0 && (
                  <div className={classes.detailSection}>
                    <Typography variant="subtitle2">
                      {i18n.t("aiTraces.detail.guardrails")}
                    </Typography>
                    {detail.guardrailEvents.map((g, i) => (
                      <Chip
                        key={i}
                        size="small"
                        className={classes.toolChip}
                        style={{ backgroundColor: red[600], color: "#fff" }}
                        label={`${g.tool}: ${g.reason}`}
                      />
                    ))}
                  </div>
                )}

              {detail.finalText && (
                <div className={classes.detailSection}>
                  <Typography variant="subtitle2">
                    {i18n.t("aiTraces.detail.finalText")}
                  </Typography>
                  <Paper variant="outlined" style={{ padding: 10 }}>
                    <Typography variant="body2" className={classes.mono}>
                      {detail.finalText}
                    </Typography>
                  </Paper>
                </div>
              )}

              {detail.error && (
                <div className={classes.detailSection}>
                  <Typography variant="subtitle2" style={{ color: red[700] }}>
                    {i18n.t("aiTraces.detail.error")}
                  </Typography>
                  <Typography
                    variant="body2"
                    className={classes.mono}
                    style={{ color: red[700] }}
                  >
                    {detail.error}
                  </Typography>
                </div>
              )}
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setDetail(null)} color="primary">
                {i18n.t("aiTraces.detail.close")}
              </Button>
            </DialogActions>
          </>
        )}
      </Dialog>

      <MainHeader>
        <Title>{i18n.t("aiTraces.title")}</Title>
        <MainHeaderButtonsWrapper>
          <IconButton onClick={handleRefresh} title={i18n.t("aiTraces.refresh")}>
            <Refresh />
          </IconButton>
        </MainHeaderButtonsWrapper>
      </MainHeader>

      <Typography className={classes.hint} variant="body2" color="textSecondary">
        {i18n.t("aiTraces.hint")}
      </Typography>

      {summary && (
        <Grid container spacing={1} style={{ marginBottom: 16 }}>
          {renderCard(i18n.t("aiTraces.cards.turns"), summary.turns)}
          {renderCard(
            i18n.t("aiTraces.cards.tokens"),
            `${summary.inputTokens}/${summary.outputTokens}`
          )}
          {renderCard(i18n.t("aiTraces.cards.cost"), fmtUsd(summary.costUsd))}
          {renderCard(
            i18n.t("aiTraces.cards.avgLatency"),
            `${summary.avgLatencyMs} ms`
          )}
          {renderCard(i18n.t("aiTraces.cards.transfers"), summary.transfers)}
          {renderCard(i18n.t("aiTraces.cards.errors"), summary.errors)}
        </Grid>
      )}

      <div className={classes.filterRow}>
        <TextField
          label={i18n.t("aiTraces.filterTicket")}
          value={ticketFilter}
          onChange={e => setTicketFilter(e.target.value.replace(/\D/g, ""))}
          size="small"
          style={{ width: 160 }}
        />
        <Button variant="outlined" size="small" onClick={fetchTraces}>
          {i18n.t("aiTraces.applyFilter")}
        </Button>
      </div>

      <Paper className={classes.mainPaper} variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>{i18n.t("aiTraces.table.when")}</TableCell>
              <TableCell>{i18n.t("aiTraces.table.contact")}</TableCell>
              <TableCell>{i18n.t("aiTraces.table.agent")}</TableCell>
              <TableCell align="center">{i18n.t("aiTraces.table.tokens")}</TableCell>
              <TableCell align="center">{i18n.t("aiTraces.table.cost")}</TableCell>
              <TableCell align="center">{i18n.t("aiTraces.table.latency")}</TableCell>
              <TableCell align="center">{i18n.t("aiTraces.table.steps")}</TableCell>
              <TableCell>{i18n.t("aiTraces.table.tools")}</TableCell>
              <TableCell align="center">{i18n.t("aiTraces.table.status")}</TableCell>
              <TableCell align="center">{i18n.t("aiTraces.table.actions")}</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {loading ? (
              <TableRowSkeleton columns={10} />
            ) : records.length === 0 ? (
              <TableRow>
                <TableCell colSpan={10} align="center">
                  <Typography color="textSecondary">
                    {i18n.t("aiTraces.empty")}
                  </Typography>
                </TableCell>
              </TableRow>
            ) : (
              records.map(r => (
                <TableRow key={r.id} hover>
                  <TableCell>{fmtDate(r.createdAt)}</TableCell>
                  <TableCell>
                    {contactLabel(r)}
                    {r.ticketId ? (
                      <Typography variant="caption" color="textSecondary">
                        {" "}
                        (#{r.ticketId})
                      </Typography>
                    ) : null}
                  </TableCell>
                  <TableCell>{r.agent ? r.agent.name : "-"}</TableCell>
                  <TableCell align="center">
                    {r.inputTokens}/{r.outputTokens}
                  </TableCell>
                  <TableCell align="center">{fmtUsd(r.costUsd)}</TableCell>
                  <TableCell align="center">{r.latencyMs} ms</TableCell>
                  <TableCell align="center">{r.steps}</TableCell>
                  <TableCell>{renderToolChips(r.toolCalls)}</TableCell>
                  <TableCell align="center">
                    <Chip
                      size="small"
                      label={i18n.t(`aiTraces.status.${r.status}`) || r.status}
                      style={{
                        backgroundColor: statusColor(r.status),
                        color: "#fff"
                      }}
                    />
                  </TableCell>
                  <TableCell align="center">
                    <Tooltip title={i18n.t("aiTraces.detail.title")}>
                      <IconButton size="small" onClick={() => setDetail(r)}>
                        <Visibility fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Paper>
      <Divider />
    </MainContainer>
  );
};

export default AITraces;
